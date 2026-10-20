/**
 * components/toast.js — Notifications transitoires (Sprint 2 Phase 2).
 *
 * Le toast est un élément #toast présent dans le DOM d'index.html.
 * showToast(msg, type, dur, extraHTML) affiche le toast pendant `dur` ms.
 *
 * Types : '' (info default), 'err' (rouge), 'ok' (vert), 'warn' (orange).
 *
 * extraHTML est ajouté tel quel après le msg échappé — utilisé pour le bouton
 * « ↶ Annuler » du système UNDO-OP v14.21.
 */

import { escHtml } from '../core/utils.js';

// ── Où poser le toast sur téléphone (audit stockage lots 2-3, 🟠3 + vérification finale) ──────────
// Sur téléphone (≤ 767 px, comme css/main.css), la feuille de style colle le toast en bas (bottom
// 12 px, z 999). Il ne doit recouvrir NI la barre du bas, NI le pied collant d'une page plein écran :
//   - une couche plein écran est ouverte (modale .ov, page EDL) : la barre du bas est masquée, et le
//     PIED COLLANT (Enregistrer, Précédent / Suivant…) est sticky — en bas de l'écran, OU juste sous un
//     contenu court (mesuré à 390 px : pied de ov-loyer-bien à 297-366). Le toast reste en bas s'il
//     tient SOUS le pied ; sinon il se pose JUSTE AU-DESSUS du pied. Dans les deux cas juste au-dessus
//     de la couche (sinon il passe dessous : #ov-edl est à 1001, la feuille de style dit 999) ;
//   - sinon, la barre du bas est affichée → au-dessus d'elle (1600) ;
//   - dans tous ces cas, au-dessus de la bannière « Installer Propryo » si elle est affichée (#pwa-invite,
//     1500 — elle passe aussi par-dessus la page EDL) : un message recouvert n'est pas un message dit ;
//   - sinon : la place et le z-index de la feuille de style, inchangés.
// TABLETTE (768-1023 px, pilotage 06/10) : même placement PAR COUCHE — sinon le toast (z 999) passe
// sous la page EDL plein écran (#ov-edl, 1001) et reste invisible. Il garde sa place de la feuille de
// style (bas 28 px, à droite) s'il tient sous le pied collant, sinon il se pose juste au-dessus. Le
// placement au-dessus de la barre du bas reste réservé au téléphone.
// PC (≥ 1024 px) : rien ne change. Le z-index n'est jamais BAISSÉ sous celui de la feuille de style
// (ex. index.html : page de dépôt du DDT, z 2147483001). Le toast ne capte aucun appui (css/main.css,
// pointer-events), sauf son propre bouton « ↶ Annuler ».

export const TOAST_ECART = 12;
export const TOAST_Z_BARRE = 1600;
export const TOAST_TELEPHONE_MQ = '(max-width: 767px)';
export const TOAST_COUCHE_MQ = '(max-width: 1023px)';   // téléphone ET tablette : placement par couche
const SEL_COUCHES = '.ov:not(.hidden), .edl-page.edl-lpage';
// Pieds NOMMÉS : reconnus même en position static. `qd-foot` = pied de l'éditeur de quittance (#ov-quit-editeur,
// z 1000), collé en bas par un flex et non par sticky (audit toast tablette B1 : le toast couvrait « Éditer »).
const SEL_PIEDS = '.m-foot, .modal-foot, .mf, .edl-rail, .edl-page-foot, .qd-foot, [class*="foot"]';
const PIEDS_NOMMES = /(^|\s)(m-foot|modal-foot|mf|edl-rail|edl-page-foot|qd-foot)(\s|$)/;

/**
 * Décision PURE. Distances en px depuis le BAS de l'écran.
 * @param {object} o
 * @param {boolean} o.telephone
 * @param {boolean} o.tablette 768-1023 px : placement par couche seulement (jamais au-dessus de la barre du bas)
 * @param {number}  o.basCss   distance au bas selon la feuille de style (tablette : 28 ; défaut TOAST_ECART)
 * @param {number}  o.barre    hauteur de la barre du bas affichée (0 = masquée)
 * @param {object|null} o.couche  couche plein écran du dessus : { z, pied } ; pied = { haut, bas } (haut et
 *                             bas du pied collant), ou null s'il n'y en a pas
 * @param {number}  o.zCss     z-index du toast selon la feuille de style
 * @param {number}  o.zBanniere z-index de la bannière « Installer Propryo » affichée (0 = absente)
 * @param {number}  o.hauteur  hauteur du toast (0 = inconnue)
 * @param {number}  o.vh       hauteur de l'écran (0 = inconnue)
 * @returns {{ bas:number|null, z:number|null }} null = la feuille de style décide
 */
export function placementToast({ telephone = false, tablette = false, basCss = 0, barre = 0, couche = null, zCss = 0, zBanniere = 0, hauteur = 0, vh = 0 } = {}) {
  if (!telephone && !tablette) return { bas: null, z: null };
  const zMin = Math.max(zCss, zBanniere > 0 ? zBanniere + 1 : 0);
  if (couche) {
    const z = Math.max(zMin, (couche.z || 0) + 1);
    // Sa place habituelle : 12 px sur téléphone (posée en ligne), celle de la feuille de style sur tablette.
    const base = telephone ? TOAST_ECART : (basCss > 0 ? basCss : TOAST_ECART);
    const aSaPlace = telephone ? TOAST_ECART : null;
    const p = couche.pied;
    if (!p) return { bas: aSaPlace, z };
    // Pied haut (contenu court) : le toast tient SOUS lui, à sa place habituelle.
    if (hauteur > 0 && base + hauteur + TOAST_ECART <= p.bas) return { bas: aSaPlace, z };
    // Sinon AU-DESSUS du pied, sans sortir de l'écran.
    let bas = p.haut + TOAST_ECART;
    if (vh > 0 && hauteur > 0 && bas + hauteur > vh - TOAST_ECART) bas = Math.max(TOAST_ECART, vh - hauteur - TOAST_ECART);
    return { bas, z };
  }
  if (telephone && barre > 0) return { bas: barre + TOAST_ECART, z: Math.max(zMin, TOAST_Z_BARRE) };
  return { bas: null, z: null };
}

/** Ce que l'écran montre : téléphone ? barre du bas ? couche plein écran du dessus et son pied collant ? */
export function mesurerEcran(doc = globalThis.document, win = globalThis.window) {
  const vh = win.innerHeight;
  const telephone = !!(win.matchMedia && win.matchMedia(TOAST_TELEPHONE_MQ).matches);
  const tablette = !telephone && !!(win.matchMedia && win.matchMedia(TOAST_COUCHE_MQ).matches);
  const visible = n => { const c = win.getComputedStyle(n); return c.display !== 'none' && c.visibility !== 'hidden'; };
  const b = doc.querySelector('.v4-bnav');
  const barre = (b && visible(b)) ? Math.ceil(b.getBoundingClientRect().height) : 0;
  const pwa = doc.querySelector('#pwa-invite');
  const zBanniere = (pwa && visible(pwa)) ? (parseInt(win.getComputedStyle(pwa).zIndex, 10) || 0) : 0;
  let couche = null;
  let zCouche = -Infinity;
  for (const n of doc.querySelectorAll(SEL_COUCHES)) {
    if (!visible(n)) continue;
    const z = parseInt(win.getComputedStyle(n).zIndex, 10) || 0;
    if (z >= zCouche) { zCouche = z; couche = n; }          // la plus haute ; à égalité, la dernière du DOM
  }
  if (!couche) return { telephone, tablette, barre, zBanniere, vh, couche: null };
  // Le pied collant : un pied NOMMÉ (m-foot, rail EDL…) ou un « *foot* » sticky / fixe, visible à l'écran,
  // pas plus haut que la moitié de l'écran. Plusieurs : leur zone commune.
  let pied = null;
  for (const f of couche.querySelectorAll(SEL_PIEDS)) {
    if (!visible(f)) continue;
    const pos = win.getComputedStyle(f).position;
    if (!PIEDS_NOMMES.test(String(f.className || '')) && pos !== 'sticky' && pos !== 'fixed') continue;
    const r = f.getBoundingClientRect();
    if (!(r.height > 0 && r.height <= vh / 2 && r.top < vh && r.bottom > 0)) continue;
    const haut = Math.ceil(vh - r.top), bas = Math.max(0, Math.floor(vh - r.bottom));
    pied = pied ? { haut: Math.max(pied.haut, haut), bas: Math.min(pied.bas, bas) } : { haut, bas };
  }
  return { telephone, tablette, barre, zBanniere, vh, couche: { z: zCouche, pied } };
}

/** Applique la décision au toast (styles en ligne, retirés quand la feuille de style décide). Ne lève jamais. */
export function placerToast(t, doc = globalThis.document, win = globalThis.window) {
  try {
    t.style.removeProperty('bottom');
    t.style.removeProperty('z-index');
    const cs = win.getComputedStyle(t);
    const zCss = parseInt(cs.zIndex, 10) || 0;
    const basCss = parseFloat(cs.bottom) || 0;          // place de la feuille de style (styles en ligne retirés)
    const hauteur = Math.ceil(t.getBoundingClientRect().height) || 0;
    const p = placementToast(Object.assign(mesurerEcran(doc, win), { zCss, basCss, hauteur }));
    if (p.bas != null) t.style.setProperty('bottom', p.bas + 'px', 'important');
    if (p.z != null) t.style.setProperty('z-index', String(p.z), 'important');
    return p;
  } catch (_e) { return null; }
}

/**
 * @param {string} msg - Le message principal (sera échappé HTML)
 * @param {''|'err'|'ok'|'warn'} type - Type d'icone/couleur
 * @param {number} dur - Durée d'affichage en ms (défaut 2800)
 * @param {string} extraHTML - HTML brut additionnel (utiliser avec parcimonie)
 */
export function showToast(msg, type = '', dur = 2800, extraHTML = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = escHtml(msg) + (extraHTML || '');
  t.style.display = 'flex';
  t.style.alignItems = 'center';
  t.style.gap = '6px';
  t.style.color =
    type === 'err' ? 'var(--red)' :
    type === 'ok'  ? 'var(--grn)' :
    type === 'warn' ? 'var(--ora)' : 'var(--t1)';
  placerToast(t);
  clearTimeout(window._toastTmr);
  window._toastTmr = setTimeout(() => t.style.display = 'none', dur);
}
