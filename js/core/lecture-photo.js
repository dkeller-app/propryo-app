// js/core/lecture-photo.js — LECTURE-PHOTOS (v15.751 provisoire) : lire le code 2D-Doc d'une PHOTO, sur l'appareil.
// Rien n'est envoyé : la photo est lue dans le navigateur (Worker : lecture-photo-worker.js), puis le texte lu passe à
// la vérification de signature EXISTANTE (deux-d-doc.js, inchangée). Un code mal lu ne peut pas être « valide » :
// correction d'erreurs Reed-Solomon du DataMatrix, puis signature ECDSA.
//
// Étapes (mesurées sur 884 photos synthétiques, mockups/LECTURE-PHOTOS/prototype : 5 % → 71 % de codes lus) :
//   0. image entière ; 1. LOCALISER les zones qui ressemblent à un code (texture dense, ~50 % d'encre, presque carrée) ;
//   2. RECADRER, trouver le QUADRILATÈRE du code (deux segmentations : seuil fin, tache floutée), REDRESSER la perspective ;
//   3. relire la GRILLE module par module (taille, orientation et coins ajustés sur le motif connu du DataMatrix), avec
//      une ÉGALISATION contre le flou, puis redessiner un code net pour le décodeur ; 4. budget d'essais et délai.
// Module pur : aucune dépendance au DOM ; images en niveaux de gris {w, h, d:Uint8Array} ; décodeur injecté.
// Testé par __tests__/helpers/lecture-photo.test.js (spécimens officiels, lecteur réel js/vendor/zxing-library).

// ───────── outils images (u8) ─────────
const gris = (w, h, v = 255) => ({ w, h, d: new Uint8Array(w * h).fill(v) });
function integrale(g) {
  const W = g.w + 1, I = new Float64Array(W * (g.h + 1));
  for (let y = 0; y < g.h; y++) { let s = 0; for (let x = 0; x < g.w; x++) { s += g.d[y * g.w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + s; } }
  return { I, W, somme: (x0, y0, x1, y1) => I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0] };
}
/** Réduction (moyenne de boîtes) ou agrandissement (bilinéaire) vers w×h. */
export function redimensionner(g, w, h) {
  const o = gris(w, h); const fx = g.w / w, fy = g.h / h;
  if (fx > 1 || fy > 1) {
    const { somme } = integrale(g);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(g.w, Math.floor((x + 1) * fx)));
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(g.h, Math.floor((y + 1) * fy)));
      o.d[y * w + x] = somme(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
    }
    return o;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.d[y * w + x] = bilin(g, (x + 0.5) * fx - 0.5, (y + 0.5) * fy - 0.5);
  return o;
}
function bilin(g, x, y, fond = 255) {
  if (x < -0.5 || y < -0.5 || x > g.w - 0.5 || y > g.h - 0.5) return fond;
  x = Math.min(g.w - 1.001, Math.max(0, x)); y = Math.min(g.h - 1.001, Math.max(0, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * g.w + x0, d = g.d;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + g.w] * (1 - fx) + d[i + g.w + 1] * fx) * fy;
}
export function recadrer(g, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(g.w, Math.ceil(x1)); y1 = Math.min(g.h, Math.ceil(y1));
  const o = gris(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  for (let y = 0; y < o.h; y++) o.d.set(g.d.subarray((y0 + y) * g.w + x0, (y0 + y) * g.w + x0 + o.w), y * o.w);
  return o;
}
function marge(g, m) { const o = gris(g.w + 2 * m, g.h + 2 * m); for (let y = 0; y < g.h; y++) o.d.set(g.d.subarray(y * g.w, (y + 1) * g.w), (y + m) * o.w + m); return o; }
/** Seuil local (Bradley) : noir si v < moyenne(fenêtre) × (1 − t). Renvoie 0/1 (1 = encre). */
export function binariser(g, fen, t = 0.12, delta = 0) {
  const { somme } = integrale(g); const r = Math.max(2, fen >> 1); const B = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(g.h, y + r + 1);
    for (let x = 0; x < g.w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(g.w, x + r + 1);
      const m = somme(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0)); const v = g.d[y * g.w + x]; B[y * g.w + x] = v < m * (1 - t) && m - v > delta ? 1 : 0; } }
  return B;
}
function flou(g, s) {
  if (s > 2) return flouBoites(g, s);
  const r = Math.max(1, Math.ceil(2.5 * s)), k = []; let t = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * s * s)); k.push(v); t += v; }
  const tmp = new Float32Array(g.w * g.h), o = gris(g.w, g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += g.d[y * g.w + Math.min(g.w - 1, Math.max(0, x + i))] * k[i + r]; tmp[y * g.w + x] = v / t; }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += tmp[Math.min(g.h - 1, Math.max(0, y + i)) * g.w + x] * k[i + r]; o.d[y * g.w + x] = v / t; }
  return o;
}
/** Flou gaussien approché par 3 passes de moyennes glissantes (coût indépendant de σ). */
function flouBoites(g, s) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * s * s + 1) - 1) / 2));   // 3 boîtes de largeur 2r+1 : variance ≈ σ²
  let a = Float32Array.from(g.d), b = new Float32Array(a.length);
  const passe = (src, dst, horiz) => {
    const L = horiz ? g.w : g.h, n = horiz ? g.h : g.w;
    for (let k = 0; k < n; k++) {
      const at = (t) => { t = t < 0 ? 0 : t >= L ? L - 1 : t; return horiz ? src[k * g.w + t] : src[t * g.w + k]; };
      let somme = 0; for (let t = -r; t <= r; t++) somme += at(t);
      for (let t = 0; t < L; t++) { const v = somme / (2 * r + 1); if (horiz) dst[k * g.w + t] = v; else dst[t * g.w + k] = v; somme += at(t + r + 1) - at(t - r); }
    }
  };
  for (let i = 0; i < 3; i++) { passe(a, b, true); passe(b, a, false); }
  const o = gris(g.w, g.h); for (let i = 0; i < o.d.length; i++) o.d[i] = a[i]; return o;
}
function renforcer(g, s, a) { const f = flou(g, s); const o = gris(g.w, g.h); for (let i = 0; i < o.d.length; i++) { const v = g.d[i] + a * (g.d[i] - f.d[i]); o.d[i] = v < 0 ? 0 : v > 255 ? 255 : v; } return o; }
/** Étirement de contraste par percentiles (2 % / 98 %). */
function etirer(g) {
  const h = new Uint32Array(256); for (const v of g.d) h[v]++;
  const n = g.d.length; let c = 0, lo = 0, hi = 255; for (let v = 0; v < 256; v++) { c += h[v]; if (c >= n * 0.02) { lo = v; break; } }
  c = 0; for (let v = 255; v >= 0; v--) { c += h[v]; if (c >= n * 0.02) { hi = v; break; } }
  if (hi - lo < 8) return g; const o = gris(g.w, g.h); for (let i = 0; i < n; i++) o.d[i] = Math.max(0, Math.min(255, (g.d[i] - lo) * 255 / (hi - lo))); return o;
}
/** Dilatation / érosion binaire par un carré (2r+1) — séparable. */
function morpho(B, w, h, r, dilate) {
  // fenêtre glissante : nombre de pixels « actifs » (1 pour dilater, 0 pour éroder) dans la fenêtre
  const v = dilate ? 1 : 0, t = new Uint8Array(B.length), o = new Uint8Array(B.length);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x <= Math.min(w - 1, r); x++) if (B[y * w + x] === v) c++;
    for (let x = 0; x < w; x++) { t[y * w + x] = c > 0 ? v : 1 - v; const xa = x + r + 1, xs = x - r; if (xa < w && B[y * w + xa] === v) c++; if (xs >= 0 && B[y * w + xs] === v) c--; } }
  for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y <= Math.min(h - 1, r); y++) if (t[y * w + x] === v) c++;
    for (let y = 0; y < h; y++) { o[y * w + x] = c > 0 ? v : 1 - v; const ya = y + r + 1, ys = y - r; if (ya < h && t[ya * w + x] === v) c++; if (ys >= 0 && t[ys * w + x] === v) c--; } }
  return o;
}
const fermer = (B, w, h, r) => morpho(morpho(B, w, h, r, true), w, h, r, false);

// ───────── géométrie ─────────
function enveloppe(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const x = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && x(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && x(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
const aireTri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
/** Quadrilatère de plus grande aire dont les sommets sont des sommets de l'enveloppe (O(n³), n ≤ 72). */
export function quadMax(h) {
  if (h.length > 72) { const k = h.length / 72; const s = []; for (let i = 0; i < 72; i++) s.push(h[Math.floor(i * k)]); h = s; }
  const n = h.length; if (n < 4) return null;
  let best = -1, q = null;
  for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) {
    let b1 = -1, j1 = -1; for (let j = i + 1; j < k; j++) { const a = aireTri(h[i], h[j], h[k]); if (a > b1) { b1 = a; j1 = j; } }
    let b2 = -1, l2 = -1; for (let l = k + 1; l < n + i; l++) { const a = aireTri(h[i], h[k], h[l % n]); if (a > b2) { b2 = a; l2 = l % n; } }
    if (j1 >= 0 && l2 >= 0 && b1 + b2 > best) { best = b1 + b2; q = [h[i], h[j1], h[k], h[l2]]; }
  }
  return q;
}
export function homographie(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i]; A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]]; const piv = A[c][c]; if (Math.abs(piv) < 1e-12) return null;
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / piv; if (!f) continue; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]); return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
/** Redresse le quadrilatère `quad` (sens quelconque) vers un carré de côté S, entouré d'une marge blanche m.
 *  `deborde` : fraction du côté échantillonnée au-delà du quadrilatère (tolérance aux coins imprécis). */
export function redresser(g, quad, S, m, deborde = 0.04) {
  // ordre horaire à partir du coin le plus en haut à gauche
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4, cy = quad.reduce((s, p) => s + p[1], 0) / 4;
  const q = quad.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let i0 = 0; for (let i = 1; i < 4; i++) if (q[i][0] + q[i][1] < q[i0][0] + q[i0][1]) i0 = i;
  const qq = [0, 1, 2, 3].map((k) => q[(i0 + k) % 4]);
  const H = homographie([[m, m], [m + S, m], [m + S, m + S], [m, m + S]], qq); if (!H) return null;
  const T = S + 2 * m, o = gris(T, T), lim = S * deborde;
  for (let v = 0; v < T; v++) for (let u = 0; u < T; u++) {
    if (u < m - lim || v < m - lim || u > m + S + lim || v > m + S + lim) continue;
    const z = H[6] * u + H[7] * v + H[8]; o.d[v * T + u] = bilin(g, (H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z);
  }
  return o;
}

// ───────── 1. localisation ─────────
/**
 * Zones candidates (coordonnées de `g`), triées de la plus probable à la moins probable.
 * Un 2D-Doc est une zone dense en transitions, à ~50 % d'encre, presque carrée ; le texte imprimé est dense mais
 * clair (~15 % d'encre) et en lignes ; un logo est sombre mais pauvre en transitions.
 */
export function localiser(g, opts = {}) {
  const cible = opts.cible || 1400; const k = Math.min(1, cible / Math.max(g.w, g.h));
  const L = flou(k < 1 ? redimensionner(g, Math.round(g.w * k), Math.round(g.h * k)) : g, 0.7);
  const b = opts.bloc || 8, BW = Math.floor(L.w / b), BH = Math.floor(L.h / b);
  // par bloc : moyenne, 10e et 90e centiles (robustes au bruit), énergie de gradient
  const moy = new Float32Array(BW * BH), mn = new Float32Array(BW * BH), mx = new Float32Array(BW * BH), gr = new Float32Array(BW * BH);
  const val = new Float32Array(b * b);
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
    let s = 0, e = 0, n = 0;
    for (let y = by * b; y < by * b + b; y++) for (let x = bx * b; x < bx * b + b; x++) {
      const v = L.d[y * L.w + x]; s += v; val[n++] = v;
      if (x + 1 < L.w) e += Math.abs(v - L.d[y * L.w + x + 1]); if (y + 1 < L.h) e += Math.abs(v - L.d[(y + 1) * L.w + x]);
    }
    val.sort();
    const i = by * BW + bx; moy[i] = s / n; mn[i] = val[Math.floor(n * 0.1)]; mx[i] = val[Math.floor(n * 0.9)]; gr[i] = e / (2 * n);
  }
  // niveaux papier / encre du voisinage (5×5 blocs) ; un bloc de code contient lui-même encre ET papier
  const R = 2, M = new Uint8Array(BW * BH), sc = new Float32Array(BW * BH);
  for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
    let P = 0, K = 255, ge = 0, n = 0, sm = 0, propre = 0;
    for (let y = Math.max(0, by - R); y <= Math.min(BH - 1, by + R); y++) for (let x = Math.max(0, bx - R); x <= Math.min(BW - 1, bx + R); x++) { const j = y * BW + x; if (mx[j] > P) P = mx[j]; if (mn[j] < K) K = mn[j]; }
    const c = P - K; const i0 = by * BW + bx; if (c < (opts.contrasteMin || 25)) continue;
    for (let y = Math.max(0, by - 1); y <= Math.min(BH - 1, by + 1); y++) for (let x = Math.max(0, bx - 1); x <= Math.min(BW - 1, bx + 1); x++) { const j = y * BW + x; ge += gr[j]; sm += moy[j]; n++; if (mx[j] - mn[j] > 0.35 * c) propre++; }
    const r = (P - sm / n) / c, e = ge / n / c, p = propre / n;
    if (r > 0.33 && r < 0.75 && p >= 0.75 && e > (opts.seuilE || 0.05)) { M[i0] = 1; sc[i0] = e * (1 - Math.abs(r - 0.5)); }
  }
  // composantes connexes de blocs (8-voisinage)
  const lab = new Int32Array(BW * BH).fill(-1), zones = [];
  for (let i = 0; i < M.length; i++) {
    if (!M[i] || lab[i] >= 0) continue;
    const pile = [i]; lab[i] = zones.length; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0, s = 0;
    while (pile.length) {
      const j = pile.pop(), x = j % BW, y = (j / BW) | 0; n++; s += sc[j];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= BW || yy >= BH) continue; const q = yy * BW + xx; if (M[q] && lab[q] < 0) { lab[q] = zones.length; pile.push(q); } }
    }
    const lw = x1 - x0 + 1, lh = y1 - y0 + 1, ratio = Math.max(lw, lh) / Math.min(lw, lh), remp = n / (lw * lh);
    if (n < 6 || ratio > 2.6 || remp < 0.35) { zones.push(null); continue; }
    zones.push({ x0: x0 * b / k, y0: y0 * b / k, x1: (x1 + 1) * b / k, y1: (y1 + 1) * b / k, score: s * remp / Math.sqrt(ratio), n });
  }
  return zones.filter(Boolean).sort((a, c) => c.score - a.score).slice(0, opts.max || 5);
}

// ───────── 2-3. recadrage, quadrilatère, redressement ─────────
/** Bruit (écart-type) estimé par la médiane des écarts au voisinage (robuste aux bords). */
function bruitEstime(g) {
  const h = new Uint32Array(256); let n = 0;
  for (let y = 0; y < g.h - 1; y += 2) for (let x = 0; x < g.w - 1; x += 2) { const i = y * g.w + x; const d = Math.abs(g.d[i] - (g.d[i + 1] + g.d[i + g.w]) / 2); h[Math.min(255, d | 0)]++; n++; }
  let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= n / 2) return 1.4826 * v / 1.22; } return 0;
}
/**
 * Segmentation « tache » : le code est flouté exprès (≈ 1 module) jusqu'à devenir un carré gris uniforme, plus sombre
 * que le papier ; l'éclairage est aplani (fond = maximum local) ; seuil à mi-chemin entre le papier et le gris du code.
 * Robuste au bruit et au faible contraste (là où le seuil fin morcelle le code).
 */
function segmenterTache(c, cote) {
  const h0 = new Uint32Array(256); for (const v of c.d) h0[v]++; let a = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { a += h0[v]; if (a >= c.d.length * 0.05) { lo = v; break; } } a = 0; for (let v = 255; v >= 0; v--) { a += h0[v]; if (a >= c.d.length * 0.05) { hi = v; break; } }
  const K = Math.max(8, hi - lo), nb = bruitEstime(c);
  const s = Math.min(cote / 15, Math.max(cote / 45, nb / (0.354 * K)));
  const cf = flou(c, s);
  // fond : maximum local sur ~ un quart de code, calculé en réduit puis agrandi
  const f = 8, pw = Math.ceil(c.w / f), ph = Math.ceil(c.h / f), p = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { let m = 0; for (let yy = y * f; yy < Math.min(c.h, y * f + f); yy++) for (let xx = x * f; xx < Math.min(c.w, x * f + f); xx++) m = Math.max(m, cf.d[yy * c.w + xx]); p[y * pw + x] = m; }
  const R = Math.max(1, Math.ceil(cote / 4 / f)), q = new Float32Array(pw * ph), q2 = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { let m = 0; for (let i = -R; i <= R; i++) { const xx = x + i; if (xx >= 0 && xx < pw) m = Math.max(m, p[y * pw + xx]); } q[y * pw + x] = m; }
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { let m = 0; for (let i = -R; i <= R; i++) { const yy = y + i; if (yy >= 0 && yy < ph) m = Math.max(m, q[yy * pw + x]); } q2[y * pw + x] = m; }
  const norm = new Float32Array(c.w * c.h);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const fx = Math.min(pw - 1.001, Math.max(0, x / f - 0.5)), fy = Math.min(ph - 1.001, Math.max(0, y / f - 0.5)); const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    const bg = (q2[y0 * pw + x0] * (1 - ax) + q2[y0 * pw + x0 + 1] * ax) * (1 - ay) + (q2[(y0 + 1) * pw + x0] * (1 - ax) + q2[(y0 + 1) * pw + x0 + 1] * ax) * ay;
    norm[y * c.w + x] = cf.d[y * c.w + x] / Math.max(1, bg); }
  const tri = Float32Array.from(norm).sort(); const gcode = tri[Math.floor(tri.length * 0.14)];
  const t = (1 + gcode) / 2, B = new Uint8Array(c.w * c.h);
  for (let i = 0; i < B.length; i++) B[i] = norm[i] < t ? 1 : 0;
  return B;
}
/** Dans un recadrage, trouve le quadrilatère du code (tache soudée la plus grande près du centre). */
export function trouverQuad(c, cote, mode = 'fin') {
  let B, r;
  if (mode === 'fin') {
    const cf = flou(c, Math.max(0.8, cote / 400));
    const h = new Uint32Array(256); for (const v of cf.d) h[v]++; let a = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { a += h[v]; if (a >= cf.d.length * 0.05) { lo = v; break; } } a = 0; for (let v = 255; v >= 0; v--) { a += h[v]; if (a >= cf.d.length * 0.05) { hi = v; break; } }
    B = binariser(cf, Math.max(15, Math.round(cote / 3)) | 1, 0.03, 0.22 * (hi - lo));
    r = Math.max(1, Math.round(cote / 55));
  } else { B = segmenterTache(c, cote); r = Math.max(1, Math.round(cote / 80)); }
  const F = fermer(B, c.w, c.h, r);
  // composante contenant le plus de pixels dans le tiers central
  const lab = new Int32Array(c.w * c.h).fill(-1); let best = null;
  const cx0 = c.w / 3, cx1 = 2 * c.w / 3, cy0 = c.h / 3, cy1 = 2 * c.h / 3;
  for (let i = 0; i < F.length; i++) {
    if (!F[i] || lab[i] >= 0) continue;
    const pile = [i]; lab[i] = i; let n = 0, centre = 0; const lignes = new Map();
    while (pile.length) {
      const j = pile.pop(), x = j % c.w, y = (j / c.w) | 0; n++;
      if (x > cx0 && x < cx1 && y > cy0 && y < cy1) centre++;
      const l = lignes.get(y); if (!l) lignes.set(y, [x, x]); else { if (x < l[0]) l[0] = x; if (x > l[1]) l[1] = x; }
      if (x > 0 && F[j - 1] && lab[j - 1] < 0) { lab[j - 1] = i; pile.push(j - 1); }
      if (x < c.w - 1 && F[j + 1] && lab[j + 1] < 0) { lab[j + 1] = i; pile.push(j + 1); }
      if (y > 0 && F[j - c.w] && lab[j - c.w] < 0) { lab[j - c.w] = i; pile.push(j - c.w); }
      if (y < c.h - 1 && F[j + c.w] && lab[j + c.w] < 0) { lab[j + c.w] = i; pile.push(j + c.w); }
    }
    if (n < cote * cote * 0.15) continue;
    const s = centre * 2 + n * 0.2;
    if (!best || s > best.s) best = { s, n, lignes, racine: i };
  }
  if (!best) return null;
  const pts = []; for (const [y, [a, b]] of best.lignes) { pts.push([a, y]); pts.push([b + 1, y]); pts.push([a, y + 1]); pts.push([b + 1, y + 1]); }
  // bords par colonnes aussi (les côtés presque horizontaux sont mieux décrits ainsi)
  const cols = new Map(); for (const [y, [a, b]] of best.lignes) for (let x = a; x <= b; x++) { const j = y * c.w + x; if (!F[j] || lab[j] !== lab[best.racine]) continue; const l = cols.get(x); if (!l) cols.set(x, [y, y]); else { if (y < l[0]) l[0] = y; if (y > l[1]) l[1] = y; } }
  const bord = pts.slice(); for (const [x, [a, b]] of cols) { bord.push([x + 0.5, a]); bord.push([x + 0.5, b + 1]); }
  let q = quadMax(enveloppe(pts)); if (!q) return null;
  // contrôle : la tache doit remplir son quadrilatère (un code fermé est plein ; un bloc de texte non)
  const aire = aireTri(q[0], q[1], q[2]) + aireTri(q[0], q[2], q[3]);
  let plein = 0; for (const [, [a, b]] of best.lignes) plein += b - a + 1;     // trous comblés : seul le contour compte
  if (plein / aire < 0.85 || plein / aire > 1.25) return null;
  return affinerQuad(q, bord) || q;
}

/** Ajuste chaque côté du quadrilatère par une droite (moindres carrés orthogonaux, 2 passes avec rejet) sur les
 *  points de bord qui lui appartiennent, puis prend les intersections : coins précis malgré la fermeture. */
export function affinerQuad(q, bord) {
  const droites = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 8) return null;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let nx = -uy, ny = ux;
    let sel = bord.filter(([x, y]) => { const t = ((x - a[0]) * ux + (y - a[1]) * uy) / L, d = Math.abs((x - a[0]) * nx + (y - a[1]) * ny); return t > 0.08 && t < 0.92 && d < L * 0.06; });
    let dr = null;
    for (let passe = 0; passe < 2; passe++) {
      if (sel.length < 6) return null;
      let mx = 0, my = 0; for (const [x, y] of sel) { mx += x; my += y; } mx /= sel.length; my /= sel.length;
      let sxx = 0, sxy = 0, syy = 0; for (const [x, y] of sel) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); const dx = Math.cos(th), dy = Math.sin(th);
      dr = { mx, my, nx: -dy, ny: dx };
      const res = sel.map(([x, y]) => Math.abs((x - mx) * dr.nx + (y - my) * dr.ny)); const s = res.slice().sort((p, r) => p - r)[Math.floor(res.length * 0.8)] + 0.5;
      sel = sel.filter((_, k) => res[k] <= s);
    }
    droites.push(dr);
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    const d1 = droites[(i + 3) % 4], d2 = droites[i];
    const c1 = d1.nx * d1.mx + d1.ny * d1.my, c2 = d2.nx * d2.mx + d2.ny * d2.my, det = d1.nx * d2.ny - d1.ny * d2.nx;
    if (Math.abs(det) < 1e-6) return null;
    const p = [(c1 * d2.ny - d1.ny * c2) / det, (d1.nx * c2 - c1 * d2.nx) / det];
    if (Math.hypot(p[0] - q[i][0], p[1] - q[i][1]) > 0.15 * Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1])) return null;
    out.push(p);
  }
  return out;
}


// ───────── 3 bis. échantillonnage de la grille (le code est relu module par module, puis redessiné net) ─────────
export const TAILLES_DM = [10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132, 144];
/** Motif connu d'un DataMatrix carré de N modules, orientation standard (L plein à gauche et en bas) : 1 noir,
 *  0 blanc, -1 donnée. Les symboles ≥ 32 ont des régions séparées par des motifs d'alignement (pleins + alternés). */
export function motifConnu(N) {
  const reg = N <= 26 ? N : N <= 52 ? N / 2 : N <= 104 ? N / 4 : N / 6;   // côté d'une région (bordures comprises)
  const m = new Int8Array(N * N).fill(-1);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ri = i % reg, rj = j % reg;
    if (ri === 0 || rj === reg - 1) m[j * N + i] = 1;                       // bords pleins de la région (gauche, bas)
    else if (rj === 0) m[j * N + i] = ri % 2 === 0 ? 1 : 0;                // haut : alterné, noir à gauche
    else if (ri === reg - 1) m[j * N + i] = rj % 2 === 1 ? 1 : 0;           // droite : alterné, noir en bas
  }
  return m;
}
const motifs = new Map();
const tourner = (i, j, N, o) => o === 0 ? [i, j] : o === 1 ? [N - 1 - j, i] : o === 2 ? [N - 1 - i, N - 1 - j] : [j, N - 1 - i];
/**
 * Lit la grille d'un code redressé (côté S, marge M).
 * 1. pour chaque taille N possible et chaque orientation, on mesure l'écart entre les modules qui DOIVENT être
 *    noirs et ceux qui DOIVENT être blancs (bordures pleines, motifs alternés, motifs d'alignement) ;
 * 2. pour les 10 meilleures hypothèses, on ajuste les 4 coins (descente par coordonnées, pas de ½ à 1/16 de module)
 *    pour maximiser cet écart — ce qui corrige les coins imprécis et la perspective résiduelle ;
 * 3. on lit chaque module (seuil local sur 9×9 modules) ; le motif connu est imposé.
 * Renvoie {N, bits, accord} (accord = part des modules connus correctement lus avant d'être imposés) ou null.
 */
export function echantillonnerGrille(w, S, M) {
  const lisse = flou(w, Math.max(0.6, S / 300));
  const pt = (C, u, v) => [(1 - u) * (1 - v) * C[0][0] + u * (1 - v) * C[1][0] + u * v * C[2][0] + (1 - u) * v * C[3][0], (1 - u) * (1 - v) * C[0][1] + u * (1 - v) * C[1][1] + u * v * C[2][1] + (1 - u) * v * C[3][1]];
  const echant = (C, N, i, j) => { const [x, y] = pt(C, (i + 0.5) / N, (j + 0.5) / N); return bilin(lisse, x, y); };
  const connusDe = (N, o) => { if (!motifs.has(N)) motifs.set(N, motifConnu(N)); const mot = motifs.get(N); const out = [];
    for (let k = 0; k < N * N; k++) if (mot[k] >= 0) { const [i, j] = tourner(k % N, (k / N) | 0, N, o); out.push([i, j, mot[k]]); } return out; };
  const ecart = (C, N, connus) => { let sn = 0, nn = 0, sb = 0, nb = 0; for (const [i, j, e] of connus) { const v = echant(C, N, i, j); if (e) { sn += v; nn++; } else { sb += v; nb++; } } return nn && nb ? sb / nb - sn / nn : -1e9; };
  const C0 = [[M, M], [M + S, M], [M + S, M + S], [M, M + S]];
  const hyp = [];
  for (const N of TAILLES_DM) { if (S / N < 2.2) break; for (let o = 0; o < 4; o++) { const c = connusDe(N, o); hyp.push({ N, o, c, e: ecart(C0, N, c) }); } }
  hyp.sort((a, b) => b.e - a.e);
  let best = null;
  for (const h of hyp.slice(0, 10)) {
    let C = C0.map((p) => p.slice()), e = h.e;
    for (const pas of [0.5, 0.25, 0.125, 0.0625]) {
      const d = pas * S / h.N; let mieux = true, tours = 0;
      while (mieux && tours++ < 6) {
        mieux = false;
        for (let k = 0; k < 4; k++) for (let ax = 0; ax < 2; ax++) for (const sg of [-1, 1]) {
          C[k][ax] += sg * d; const e2 = ecart(C, h.N, h.c);
          if (e2 > e + 1e-6) { e = e2; mieux = true; } else C[k][ax] -= sg * d;
        }
      }
    }
    // lecture des modules et accord sur les modules connus
    // valeur d'un module = moyenne de 5×5 points répartis sur sa moitié centrale (le bruit se moyenne, pas le voisin)
    const N = h.N, v = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let t = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const [x, y] = pt(C, (i + 0.5 + a * 0.11) / N, (j + 0.5 + b * 0.11) / N); t += bilin(lisse, x, y); } v[j * N + i] = t / 25; }
    const r = 4, bits = new Uint8Array(N * N);
    const I = new Float64Array((N + 1) * (N + 1)); for (let j = 0; j < N; j++) { let s2 = 0; for (let i = 0; i < N; i++) { s2 += v[j * N + i]; I[(j + 1) * (N + 1) + i + 1] = I[j * (N + 1) + i + 1] + s2; } }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x0 = Math.max(0, i - r), x1 = Math.min(N, i + r + 1), y0 = Math.max(0, j - r), y1 = Math.min(N, j + r + 1);
      const m = (I[y1 * (N + 1) + x1] - I[y0 * (N + 1) + x1] - I[y1 * (N + 1) + x0] + I[y0 * (N + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      bits[j * N + i] = v[j * N + i] < m ? 1 : 0;
    }
    let ok = 0; for (const [i, j, ex] of h.c) if (bits[j * N + i] === ex) ok++;
    const accord = ok / h.c.length, z = (2 * ok - h.c.length) / Math.sqrt(h.c.length);   // écart à un tirage au hasard
    if (!best || z > best.z) best = { N, o: h.o, bits, accord, z, v, c: h.c };
  }
  if (!best || best.accord < 0.75) return null;
  const { N, o } = best, mot = motifs.get(N);
  const versStd = (bits) => { const std = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const [ii, jj] = tourner(i, j, N, o); std[j * N + i] = mot[j * N + i] >= 0 ? mot[j * N + i] : bits[jj * N + ii]; } return std; };
  return { N, bits: versStd(best.bits), egalises: versStd(egaliser(best.v, N, best.bits, best.c)), accord: best.accord };
}
/**
 * ÉGALISATION (déconvolution sur la grille) : sur une photo floue, la valeur lue au centre d'un module dépend aussi de
 * ses voisins. Modèle linéaire v ≈ a + b·centre + c·(4 voisins) + d·(4 diagonales), coefficients estimés par moindres
 * carrés sur tout le code (modules connus imposés), puis chaque module inconnu reprend la valeur (0/1) qui explique le
 * mieux sa valeur et celles de ses voisins (modes conditionnels itérés, 4 passes).
 */
export function egaliser(v, N, bits0, connus) {
  const b = Uint8Array.from(bits0), fixe = new Uint8Array(N * N);
  for (const [i, j, e] of connus) { b[j * N + i] = e; fixe[j * N + i] = 1; }
  const B = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? 0 : b[j * N + i];
  const feat = (i, j) => [1, B(i, j), B(i - 1, j) + B(i + 1, j) + B(i, j - 1) + B(i, j + 1), B(i - 1, j - 1) + B(i + 1, j - 1) + B(i - 1, j + 1) + B(i + 1, j + 1)];
  let beta = null;
  for (let passe = 0; passe < 4; passe++) {
    // moindres carrés 4×4
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], y = [0, 0, 0, 0];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const f = feat(i, j), vv = v[j * N + i]; for (let p = 0; p < 4; p++) { y[p] += f[p] * vv; for (let q = 0; q < 4; q++) A[p][q] += f[p] * f[q]; } }
    beta = resoudre4(A, y); if (!beta || beta[1] >= 0) return bits0;
    const pred = (i, j) => { const f = feat(i, j); return beta[0] + beta[1] * f[1] + beta[2] * f[2] + beta[3] * f[3]; };
    let change = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (fixe[j * N + i]) continue;
      const cout = (val) => { b[j * N + i] = val; let c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, yy = j + dj; if (x < 0 || yy < 0 || x >= N || yy >= N) continue; const r = v[yy * N + x] - pred(x, yy); c += r * r; } return c; };
      const avant = b[j * N + i], c0 = cout(0), c1 = cout(1); b[j * N + i] = c1 < c0 ? 1 : 0; if (b[j * N + i] !== avant) change++;
    }
    if (!change) break;
  }
  return b;
}
function resoudre4(A, y) {
  const M = A.map((r, i) => r.concat([y[i]]));
  for (let c = 0; c < 4; c++) { let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-9) return null;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[4] / r[i]);
}
/** Redessine une grille de bits en image nette (module px, zone de silence qz modules). */
export function dessinerGrille(bits, N, px = 5, qz = 3) {
  const T = (N + 2 * qz) * px, o = gris(T, T);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (bits[j * N + i]) for (let y = 0; y < px; y++) o.d.fill(0, ((qz + j) * px + y) * T + (qz + i) * px, ((qz + j) * px + y) * T + (qz + i + 1) * px);
  return o;
}

// ───────── 4. orchestration ─────────
export const ESSAIS_PHOTO = 40;
const DEUX_D_DOC = (t) => typeof t === 'string' && /^DC/.test(t);          // un 2D-Doc commence toujours par « DC »
/**
 * Cherche et lit un DataMatrix sur une photo.
 * @param {{w,h,d:Uint8Array}} g  photo en niveaux de gris (≤ 3 000 px de côté)
 * @param {(g:{w,h,d})=>string|null|Promise<string|null>} lire  décodeur (lecteurZxing)
 * @param {{essais?:number, delaiMs?:number, rapide?:boolean, accepter?:(t:string)=>boolean, trace?:object}} [opts]
 *   essais : décodages au plus (40) ; delaiMs : temps au plus (arrêt entre deux étapes) ;
 *   rapide : viseur (image d'une vidéo) — 2 zones, segmentation fine seule, grille seule.
 * @returns {Promise<{texte:string|null, essais:number, etape:string|null, interrompu:boolean}>}
 */
export async function lirePhoto(g, lire, opts = {}) {
  let essais = opts.essais || ESSAIS_PHOTO, n = 0;
  const fin = opts.delaiMs ? Date.now() + opts.delaiMs : Infinity;
  const accepter = opts.accepter || DEUX_D_DOC;
  const epuise = () => essais <= 0 || Date.now() > fin;
  const essai = async (img, etape) => { if (epuise()) return null; essais--; n++; const t = await lire(img); return t && accepter(t) ? { texte: t, etape } : null; };
  // interrompu : arrêt par le TEMPS sans code lu — « pas fini », à ne pas confondre avec « aucun code » (relecture plus tard)
  const rendu = (r) => ({ texte: r ? r.texte : null, etape: r ? r.etape : null, essais: n, interrompu: !r && Date.now() > fin });
  // 0. image entière (cas facile : photo nette et cadrée)
  let r = await essai(g, 'entier'); if (r) return rendu(r);
  const zones = epuise() ? [] : localiser(g, { max: opts.rapide ? 2 : 5 });
  const tr = opts.trace; if (tr) tr.zones = zones.map((z) => ({ x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 }));
  for (const z of zones) {
    if (epuise()) break;
    const cote = Math.max(z.x1 - z.x0, z.y1 - z.y0), m = cote * 0.45;
    let c = recadrer(g, z.x0 - m, z.y0 - m, z.x1 + m, z.y1 + m);
    // échelle de travail : le code doit faire ~ 480 px (≈ 7 px par module pour 64 modules)
    const k = Math.max(0.5, Math.min(3, 480 / cote));
    if (Math.abs(k - 1) > 0.15) c = redimensionner(c, Math.round(c.w * k), Math.round(c.h * k));
    const coteK = cote * k;
    // a. recadrage seul (le détecteur du lecteur part du centre de l'image : un code centré se trouve)
    r = await essai(marge(c, 20), 'recadrage'); if (r) return rendu(r);
    // b. quadrilatère du code (deux segmentations), redressement, relecture de la grille
    const ce = etirer(c), quads = [];
    const qf = epuise() ? null : trouverQuad(ce, coteK, 'fin'); if (qf) quads.push({ q: qf, src: ce });
    if (!opts.rapide && !epuise()) {
      const qt = trouverQuad(c, coteK, 'tache');
      if (qt && !(qf && qf.every((p, i) => Math.hypot(p[0] - qt[i][0], p[1] - qt[i][1]) < coteK / 40))) quads.push({ q: qt, src: c });
    }
    for (const { q, src } of quads) {
      if (epuise()) break;
      const S = 512, M = 48, w = redresser(src, q, S, M); if (!w) continue;
      let gr0 = null;
      const variantes = [
        ['grille', () => { gr0 = echantillonnerGrille(w, S, M); return gr0 ? dessinerGrille(gr0.bits, gr0.N) : null; }],
        ['grille+egalise', () => gr0 ? dessinerGrille(gr0.egalises, gr0.N) : null]
      ];
      if (!opts.rapide) variantes.push(
        ['grille+renfort', () => { const gr = echantillonnerGrille(renforcer(w, S / 120, 1.2), S, M); return gr ? dessinerGrille(gr.bits, gr.N) : null; }],
        ['redresse', () => w]);
      for (const [nom, f] of variantes) { if (epuise()) break; const im = f(); if (!im) continue; r = await essai(im, nom); if (r) return rendu(r); }
    }
  }
  return rendu(null);
}

// ───────── 5. lecteur, conversions, netteté, issue du contrôle immédiat ─────────
/**
 * Lecteur DataMatrix de l'app (@zxing/library 0.21.3, js/vendor) réglé une fois pour toutes : DataMatrix seul,
 * « essayer plus fort », réglages PASSÉS à decode() (avant v15.751, setHints() puis decode(bitmap) les remettait à zéro :
 * tous les formats, codes-barres 1D compris, étaient cherchés), texte accepté seulement s'il commence par « DC ».
 * @param {object} ZX  espace de noms ZXing (window.ZXing / globalThis.ZXing)
 * @returns {(g:{w,h,d})=>string|null}
 */
export function lecteurZxing(ZX) {
  const reglages = new Map([[ZX.DecodeHintType.TRY_HARDER, true], [ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.DATA_MATRIX]]]);
  return (g) => {
    try {
      const lum = new ZX.RGBLuminanceSource(g.d instanceof Uint8ClampedArray ? g.d : new Uint8ClampedArray(g.d.buffer, g.d.byteOffset, g.d.length), g.w, g.h);
      const t = new ZX.MultiFormatReader().decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(lum)), reglages).getText();
      return DEUX_D_DOC(t) ? t : null;
    } catch { return null; }
  };
}
/** Pixels RGBA (ImageData.data) → niveaux de gris, même formule que le lecteur : (306 R + 601 G + 117 B + 512) >> 10. */
export function versGris(rgba, w, h) {
  const d = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (306 * rgba[j] + 601 * rgba[j + 1] + 117 * rgba[j + 2] + 0x200) >> 10;
  return { w, h, d };
}
/**
 * Netteté d'une photo : valeur haute (99,7e centile) du laplacien, rapportée au contraste (2e-98e centiles), sur une
 * version ≤ 1 000 px. Sans unité ; une photo nette d'une page imprimée donne ~1,8-2,2 (jeu synthétique), un flou
 * gênant < 0,9. Seuil à recaler au smoke sur de vraies photos (D11).
 */
export const SEUIL_FLOU = 0.9;
export function nettete(g) {
  const k = Math.min(1, 1000 / Math.max(g.w, g.h)); const L = k < 1 ? redimensionner(g, Math.round(g.w * k), Math.round(g.h * k)) : g;
  const h = new Uint32Array(256); for (const v of L.d) h[v]++; let a = 0, lo = 0, hi = 255; const n = L.d.length;
  for (let v = 0; v < 256; v++) { a += h[v]; if (a >= n * 0.02) { lo = v; break; } } a = 0; for (let v = 255; v >= 0; v--) { a += h[v]; if (a >= n * 0.02) { hi = v; break; } }
  const c = Math.max(1, hi - lo), lap = new Uint32Array(1024); let m = 0;
  for (let y = 1; y < L.h - 1; y++) for (let x = 1; x < L.w - 1; x++) { const i = y * L.w + x; const v = Math.abs(4 * L.d[i] - L.d[i - 1] - L.d[i + 1] - L.d[i - L.w] - L.d[i + L.w]); lap[Math.min(1023, v)]++; m++; }
  a = 0; let p = 0; for (let v = 1023; v >= 0; v--) { a += lap[v]; if (a >= m * 0.003) { p = v; break; } }
  return p / c;
}
/**
 * Issue du contrôle immédiat d'une photo sur la page de dépôt (D6, D8) — trois mots, jamais de verdict, jamais bloquant.
 * @param {{code:string|null, avis:boolean, nettete:number|null}} r  avis : la pièce est un avis d'impôt (type choisi)
 * @returns {null|{issue:'code_lu'|'code_illisible'|'floue', libelle:string, reprendre:boolean}}
 */
export function issueControle({ code, avis, nettete: net }) {
  if (DEUX_D_DOC(code)) return { issue: 'code_lu', libelle: "Code de l'État lu", reprendre: false };
  if (avis) return { issue: 'code_illisible', libelle: 'Code illisible', reprendre: true };
  if (typeof net === 'number' && net < SEUIL_FLOU) return { issue: 'floue', libelle: 'Photo floue', reprendre: true };
  return null;
}
