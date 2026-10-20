// js/core/indices-pdf.js — VERIF-DOCUMENTS lot 2 (v15.740 provisoire).
// Indices TECHNIQUES d'un fichier PDF, sans IA : dates et logiciels déclarés dans le fichier, nombre
// d'enregistrements successifs, textes différents superposés au même endroit.
// Ce sont des INDICES, jamais des preuves : un PDF ré-enregistré, compressé, signé, annoté ou « imprimé en PDF »
// présente les mêmes traces. Chaque constat le dit (« ne permet pas de conclure »). Aucun mot de jugement.
// Module pur (les octets, les métadonnées et la couche texte sont fournis par l'appelant). Testé par
// __tests__/helpers/indices-pdf.test.js.

export const LIMITE = 'Indice technique : il ne permet pas de conclure, un fichier ré-enregistré, compressé ou imprimé en PDF présente le même constat.';
export const SOURCE_INDICES = 'informations internes du fichier PDF';
const JOUR = 86400000;

/** Date PDF (« D:20260724080000Z », « D:20260724080000+02'00' ») → Date, ou null. */
export function lireDatePdf(s) {
  const m = String(s || '').match(/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz && tz !== 'Z') { const sg = tz[0] === '-' ? -1 : 1; const hh = +tz.slice(1, 3), mm = +tz.replace(/'/g, '').slice(3, 5) || 0; t -= sg * (hh * 60 + mm) * 60000; }
  const dt = new Date(t);
  return isNaN(dt) || +y < 1990 ? null : dt;
}

function compter(octets, motif) {
  const m = Array.from(motif, (c) => c.charCodeAt(0)); let n = 0;
  outer: for (let i = 0; i <= octets.length - m.length; i++) { for (let j = 0; j < m.length; j++) if (octets[i + j] !== m[j]) continue outer; n++; i += m.length - 1; }
  return n;
}
/**
 * Nombre d'enregistrements du fichier : chaque mise à jour incrémentale ajoute une table « startxref ».
 * Un PDF « linéarisé » (optimisé pour le web) en contient légitimement deux dès l'origine.
 */
export function compterEnregistrements(octets) {
  const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets || []);
  const n = compter(b, 'startxref');
  const tete = b.subarray(0, Math.min(b.length, 2048));
  const lineaire = compter(tete, '/Linearized') > 0;
  return { enregistrements: Math.max(n - (lineaire && n >= 2 ? 1 : 0), n ? 1 : 0), lineaire };
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/**
 * Textes différents posés au même endroit (à 1 point près) d'une même page.
 * @param {Array<{page:number, str:string, x:number, y:number}>} items  couche texte (pdf.js getTextContent)
 * @returns {Array<{page, textes:[string,string]}>}
 */
export function trouverSuperpositions(items) {
  const out = []; const vus = new Set();
  // Tri par page puis position verticale : on ne compare que les voisins à 1 point près (n log n, borné à 20 000 éléments).
  const liste = (items || []).slice(0, 20000).filter((i) => i && norm(i.str) && /[0-9A-Za-zÀ-ÿ]/.test(i.str))
    .sort((p, q) => (p.page - q.page) || (p.y - q.y) || (p.x - q.x));
  for (let a = 0; a < liste.length; a++) {
    const A = liste[a];
    for (let b = a + 1; b < liste.length; b++) {
      const B = liste[b];
      if (B.page !== A.page || B.y - A.y > 1) break;
      if (Math.abs(A.x - B.x) > 1) continue;
      if (norm(A.str) === norm(B.str)) continue; // même texte écrit deux fois (effet de gras) : pas un indice
      const cle = A.page + '|' + [norm(A.str), norm(B.str)].sort().join('|');
      if (vus.has(cle)) continue; vus.add(cle);
      out.push({ page: A.page, textes: [norm(A.str), norm(B.str)].sort() });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

const fdate = (d) => d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '';
const logiciel = (s) => norm(s).slice(0, 80);

/**
 * Constats T1-T3 (format des « Points à vérifier » : {code, icone, titre, detail, source}).
 * @param {{metadonnees?:{producteur?,createur?,creeLe?,modifieLe?}, enregistrements?:number, superpositions?:Array}} a
 */
export function indicesTechniques(a) {
  const out = []; const m = (a && a.metadonnees) || {};
  const cree = lireDatePdf(m.creeLe), modif = lireDatePdf(m.modifieLe);
  if (cree && modif && modif.getTime() - cree.getTime() > JOUR) {
    const jours = Math.floor((modif.getTime() - cree.getTime()) / JOUR);
    const avec = (l) => (l ? ` avec « ${logiciel(l)} »` : '');
    out.push({ code: 'T1', icone: 'doc', titre: 'Le fichier a été modifié après sa création.',
      detail: `Créé le ${fdate(cree)}${avec(m.createur || m.producteur)}, modifié le ${fdate(modif)}${m.producteur && m.createur && logiciel(m.producteur) !== logiciel(m.createur) ? avec(m.producteur) : ''} (${jours} jour${jours > 1 ? 's' : ''} plus tard). ${LIMITE}`,
      source: SOURCE_INDICES });
  }
  if ((a && a.enregistrements) >= 2) {
    out.push({ code: 'T2', icone: 'doc', titre: `Le fichier a été enregistré ${a.enregistrements} fois (mises à jour successives).`,
      detail: `Chaque mise à jour ajoute une couche au fichier d'origine. ${LIMITE}`, source: SOURCE_INDICES });
  }
  for (const s of (a && a.superpositions) || []) {
    out.push({ code: 'T3', icone: 'doc', titre: `Deux textes différents sont superposés au même endroit (page ${s.page}).`,
      detail: `« ${s.textes[0]} » et « ${s.textes[1]} ». Indice technique : un formulaire rempli ou une annotation peut produire ce constat ; il ne permet pas de conclure.`,
      source: SOURCE_INDICES });
  }
  return out;
}
