/**
 * js/core/tus-client.js — ENVOI REPRENABLE (protocole TUS 1.0.0) vers Supabase Storage. Sans dépendance.
 *
 * Pourquoi : une vidéo d'état des lieux pèse 5 à 25 Mo par prise ; l'envoi simple (`upload()`) n'a ni
 * reprise après coupure, ni progression. Supabase Storage accepte TUS
 * (https://supabase.com/docs/guides/storage/uploads/resumable-uploads, relevé le 14/10/2026) :
 *   - point d'entrée  https://<projet>.supabase.co/storage/v1/upload/resumable (ou l'hôte dédié <projet>.storage…) ;
 *   - morceaux de 6 Mo exactement (« it must be set to 6MB ») ;
 *   - l'adresse d'envoi reste valable 24 h.
 * Sous-ensemble du protocole implémenté (décision 13 : module maison testé, zéro dépendance) :
 *   création (POST + Upload-Length + Upload-Metadata), envoi par morceaux (PATCH + Upload-Offset),
 *   reprise (HEAD → Upload-Offset), adresse expirée (404/410 → nouvelle création), conflit (409 → HEAD).
 * `x-upsert: false` : un fichier existant n'est JAMAIS écrasé (une vidéo d'EDL est une preuve).
 * Ne lève jamais : rend { ok:true, url } ou { ok:false, code, url? } (url = à mémoriser pour reprendre).
 */

export const MORCEAU = 6 * 1024 * 1024;
const TUS = '1.0.0';

function b64(s) {
  const u = new TextEncoder().encode(String(s));
  let bin = '';
  for (const c of u) bin += String.fromCharCode(c);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}
export function metadonnees({ bucket, objet, type, cacheControl = '3600' }) {
  return [['bucketName', bucket], ['objectName', objet], ['contentType', type], ['cacheControl', cacheControl]]
    .map(([k, v]) => `${k} ${b64(v)}`).join(',');
}

/** Point d'entrée TUS depuis l'URL du projet. On garde l'hôte du projet (https://xxx.supabase.co), DÉJÀ autorisé
 *  par la politique de sécurité de l'app (connect-src) : l'hôte dédié xxx.storage.supabase.co, plus rapide pour les
 *  gros fichiers, demanderait d'élargir cette politique (à décider à l'activation de la vidéo). */
export function pointEntree(urlProjet) {
  const u = String(urlProjet || '').replace(/\/+$/, '');
  return u ? `${u}/storage/v1/upload/resumable` : '';
}

/**
 * @param {object} o
 * @param {string}   o.endpoint      point d'entrée TUS
 * @param {Function} o.getToken      () => Promise<jeton de session Supabase>
 * @param {string}   [o.apikey]      clé publique (anon) du projet
 * @param {string}   o.bucket, o.objet, o.type
 * @param {number}   o.taille        octets
 * @param {Function} o.lire          (debut, fin) => Promise<Blob|ArrayBuffer>  (morceau du fichier)
 * @param {string}   [o.url]         adresse d'envoi déjà créée (reprise)
 * @param {Function} [o.onUrl]       (url) => void  — à mémoriser AVANT le premier morceau
 * @param {Function} [o.onProgres]   (envoyes, total) => void
 * @param {Function} [o.fetchImpl], [o.attendre], [o.enLigne]
 * @param {number}   [o.essaisMax]   tentatives par morceau en cas d'erreur réseau / 5xx
 */
export function creerEnvoiTus(o) {
  const f = o.fetchImpl || ((...a) => fetch(...a));
  const attendre = o.attendre || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const enLigne = o.enLigne || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const essaisMax = o.essaisMax || 5;
  const morceau = o.morceau || MORCEAU;
  let url = o.url || '';
  let arrete = false;

  async function entetes(extra = {}) {
    let jeton = '';
    try { jeton = o.getToken ? await o.getToken() : ''; } catch (_) { jeton = ''; }
    if (!jeton) return null;
    return { 'Tus-Resumable': TUS, Authorization: `Bearer ${jeton}`, ...(o.apikey ? { apikey: o.apikey } : {}), ...extra };
  }
  async function creer() {
    const h = await entetes({ 'Upload-Length': String(o.taille), 'Upload-Metadata': metadonnees(o), 'x-upsert': 'false' });
    if (!h) return { code: 'auth' };
    let r;
    try { r = await f(o.endpoint, { method: 'POST', headers: h }); } catch (_) { return { code: enLigne() ? 'reseau' : 'offline' }; }
    if (r.status === 401 || r.status === 403) return { code: 'refuse' };
    if (r.status === 409) return { code: 'existe' };
    if (r.status === 413) return { code: 'trop_lourd' };
    if (r.status >= 500) return { code: 'reseau' };
    if (r.status !== 201) return { code: 'refuse' };
    const loc = r.headers.get('Location') || r.headers.get('location');
    if (!loc) return { code: 'refuse' };
    url = new URL(loc, o.endpoint).toString();
    try { o.onUrl && o.onUrl(url); } catch (_) { /* rien */ }
    return { offset: 0 };
  }
  async function position() {
    const h = await entetes();
    if (!h) return { code: 'auth' };
    let r;
    try { r = await f(url, { method: 'HEAD', headers: h }); } catch (_) { return { code: enLigne() ? 'reseau' : 'offline' }; }
    if (r.status === 404 || r.status === 410) return { code: 'expire' };
    if (r.status === 401 || r.status === 403) return { code: 'refuse' };
    if (!r.ok) return { code: r.status >= 500 ? 'reseau' : 'refuse' };
    const off = Number(r.headers.get('Upload-Offset'));
    return Number.isFinite(off) ? { offset: off } : { code: 'refuse' };
  }
  async function envoyer(offset) {
    const fin = Math.min(o.taille, offset + morceau);
    const corps = await o.lire(offset, fin);
    const h = await entetes({ 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' });
    if (!h) return { code: 'auth' };
    let r;
    try { r = await f(url, { method: 'PATCH', headers: h, body: corps }); } catch (_) { return { code: enLigne() ? 'reseau' : 'offline' }; }
    if (r.status === 409) return { code: 'conflit' };
    if (r.status === 404 || r.status === 410) return { code: 'expire' };
    if (r.status === 401 || r.status === 403) return { code: 'refuse' };
    if (r.status >= 500) return { code: 'reseau' };
    if (r.status !== 204 && r.status !== 200) return { code: 'refuse' };
    const off = Number(r.headers.get('Upload-Offset'));
    return { offset: Number.isFinite(off) ? off : fin };
  }

  return {
    get url() { return url; },
    arreter() { arrete = true; },
    async demarrer() {
      let offset = 0;
      let essais = 0;
      let conflits = 0;
      let recree = false;
      if (url) {
        const p = await position();
        if (p.code === 'expire') url = '';
        else if (p.code) return { ok: false, code: p.code, url };
        else offset = p.offset;
      }
      if (!url) { const c = await creer(); if (c.code) return { ok: false, code: c.code, url: '' }; offset = 0; }
      try { o.onProgres && o.onProgres(offset, o.taille); } catch (_) { /* rien */ }
      while (offset < o.taille) {
        if (arrete) return { ok: false, code: 'arrete', url };
        const r = await envoyer(offset);
        if (r.code === 'conflit') {
          // 409 répétés (objet terminé ailleurs, verrou) : au plus 3, avec attente ; position inchangée = arrêt.
          if (++conflits > 3) return { ok: false, code: 'conflit', url };
          await attendre(500 * conflits);
          const p = await position(); if (p.code) return { ok: false, code: p.code, url };
          if (p.offset === offset && conflits > 1) return { ok: false, code: 'conflit', url };
          offset = p.offset; continue;
        }
        if (r.code === 'expire') {
          if (recree) return { ok: false, code: 'expire', url: '' };
          recree = true; url = '';
          const c = await creer(); if (c.code) return { ok: false, code: c.code, url: '' };
          offset = 0; continue;
        }
        if (r.code === 'reseau' && essais < essaisMax - 1) { essais++; await attendre(Math.min(30000, 1000 * 2 ** essais)); const p = await position(); if (!p.code) offset = p.offset; continue; }
        if (r.code) return { ok: false, code: r.code, url };
        essais = 0;
        offset = r.offset;
        try { o.onProgres && o.onProgres(offset, o.taille); } catch (_) { /* rien */ }
      }
      return { ok: true, url };
    },
  };
}
