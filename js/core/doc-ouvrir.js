/**
 * core/doc-ouvrir.js — ouvrir une pièce jointe (PDF, image) stockée en data URL.
 *
 * Retours du 15/10/2026 (lot 1, point 4) — « Ouvrir » un bail / un EDL signé hors Propryo affichait une
 * PAGE BLANCHE. Reproduit en Chrome : la fenêtre recevait `<iframe src="data:application/pdf;base64,…">`.
 * Chrome plafonne une URL à 2 Mo (2 097 152 caractères) : au-delà d'un PDF d'environ 1,5 Mo (le base64
 * grossit de 4/3), l'iframe ne charge rien. 1,4 Mo s'affiche, 1,6 Mo donne une page blanche — un scan de
 * bail signé dépasse presque toujours ce seuil. Correctif : le binaire devient un Blob, ouvert par une
 * URL `blob:` courte (aucune limite de taille), comme _openCloudBailPdf ouvre une URL signée.
 *
 * Pur : aucun accès DOM. `atob` existe dans le navigateur et dans Node ≥ 16.
 * Tests : __tests__/helpers/doc-ouvrir.test.js
 */

const EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' };
const GENERIQUE = /^(application\/octet-stream|binary\/octet-stream|application\/x-download|)$/i;
// SÉCURITÉ (relecture adverse) : une URL blob: a l'ORIGINE DE L'APP. Seuls des types qui n'exécutent rien sont
// affichés ; tout le reste (SVG, HTML, XML…, même avec un paramètre « ; charset=… ») est téléchargé, jamais rendu.
const AFFICHABLES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Essence d'un type MIME : sans paramètres, en minuscules (« image/svg+xml; charset=utf-8 » → « image/svg+xml »). */
export function essenceType(t) {
  return String(t == null ? '' : t).split(';')[0].trim().toLowerCase();
}

/** En-tête d'une data URL : { mime, base64 } ; null si ce n'est pas une data URL. */
export function enteteDataUrl(dataUrl) {
  const s = String(dataUrl == null ? '' : dataUrl);
  const m = s.match(/^data:([^;,]*)((?:;[^;,]*)*),/i);
  if (!m) return null;
  return { mime: (m[1] || '').trim().toLowerCase(), base64: /;base64/i.test(m[2] || ''), debut: m[0].length };
}

/**
 * Type réel du document : le type de l'en-tête data: s'il est précis, sinon le type enregistré, sinon
 * l'extension du nom. Un binaire relu du stockage en ligne revient souvent en « application/octet-stream »
 * (FileReader sur la réponse) : sans ce repli, un PDF ne s'ouvrirait pas comme un PDF.
 */
export function typeDocument(dataUrl, mime, nom) {
  const h = enteteDataUrl(dataUrl);
  if (h && h.mime && !GENERIQUE.test(h.mime)) return essenceType(h.mime);
  const m = essenceType(mime);
  if (m && !GENERIQUE.test(m)) return m;
  const ext = (String(nom || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  return (ext && EXT[ext]) || 'application/octet-stream';
}

/** 'pdf' | 'image' | 'telecharger' — comment présenter le document (liste blanche, cf. AFFICHABLES). */
export function modeOuverture(type) {
  const t = essenceType(type);
  if (!AFFICHABLES.has(t)) return 'telecharger';
  return t === 'application/pdf' ? 'pdf' : 'image';
}

/** Type du Blob à construire : l'essence pour un type affiché, un binaire neutre pour un téléchargement. */
export function typeBlob(type) {
  return modeOuverture(type) === 'telecharger' ? 'application/octet-stream' : essenceType(type);
}

/** Octets d'une data URL (base64 ou texte encodé) ; une chaîne base64 nue est acceptée (ancien format). */
export function dataUrlEnOctets(dataUrl) {
  const s = String(dataUrl == null ? '' : dataUrl);
  const h = enteteDataUrl(s);
  if (h && !h.base64) return new TextEncoder().encode(decodeURIComponent(s.slice(h.debut)));
  const b64 = (h ? s.slice(h.debut) : s).replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
