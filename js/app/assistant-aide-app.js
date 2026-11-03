// js/app/assistant-aide-app.js — ASSISTANT D'AIDE : volet de questions sur l'UTILISATION de l'app.
// Moteur local/souverain : js/core/assistant-aide.js (pur, testé). Ce module ne fait QUE l'affichage.
// Chargé par js/main.js dans tous les modes. Points d'entrée : barre latérale « Aide › Assistant »
// et menu « Plus » (mobile), qui appellent window.Assistant.ouvrir().
//
// Responsive 3 formats : volet ancré à droite sur PC/tablette, PAGE pleine (M-16) + pied collant
// (.m-foot) sur téléphone — la bottom-nav s'efface d'elle-même (body:has(.ov:not(.hidden)) #v4-bnav).
// Souverain : aucun appel réseau, aucune donnée envoyée. Jamais bloquant : toute erreur est avalée.
import { repondre, CORPUS, AMORCES, LABELS } from '../core/assistant-aide.js'   // eslint-disable-line no-unused-vars

const W = window
const G = (n) => (typeof W[n] === 'function' ? W[n] : null)
const SUPPORT = 'support@propryo.fr'   // aucun mécanisme de support dédié dans le code : adresse par défaut.
const esc = (s) => (G('escHtml') ? W.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])))

// Line-icons (currentColor) — jamais d'icône seule : toujours accompagnées d'un libellé.
const IC_BULLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
const IC_FLECHE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>'
const IC_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

// ─────────────────────────── Overlay (construit une fois, réutilisé) ───────────────────────────
function assurerOverlay() {
  let ov = document.getElementById('ov-assistant')
  if (ov) return ov
  ov = document.createElement('div')
  ov.className = 'ov hidden'
  ov.id = 'ov-assistant'
  ov.innerHTML = `<div class="modal asa-panel" role="dialog" aria-modal="true" aria-labelledby="asa-title">
    <div class="m-head asa-head">
      <span class="asa-ic">${IC_BULLE}</span>
      <div class="asa-ht"><h3 id="asa-title">Assistant</h3><div class="asa-sub">Aide sur l’utilisation de l’app</div></div>
      <button type="button" class="m-close" data-asa-close aria-label="Fermer">${IC_CLOSE}</button>
    </div>
    <div class="asa-body" id="asa-feed" tabindex="-1"></div>
    <div class="m-foot asa-foot">
      <input id="asa-q" type="text" autocomplete="off" placeholder="Une question sur l’app…" aria-label="Champ de question sur l’app">
      <button type="button" class="asa-send" data-asa-send>Envoyer</button>
    </div>
    <div class="asa-note">Réponses issues d’une base d’aide rédigée — rien n’est inventé, aucune donnée n’est envoyée.</div>
  </div>`
  document.body.appendChild(ov)
  // Fermeture : clic sur le fond, ✕, ou Échap.
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-asa-close]')) fermer() })
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fermer() } })
  const input = ov.querySelector('#asa-q')
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); envoyer() } })
  ov.querySelector('[data-asa-send]').addEventListener('click', envoyer)
  // Délégation : chips d'exemple et bouton « → aller à l'écran ».
  ov.querySelector('#asa-feed').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-asa-chip]')
    if (chip) { demander(chip.getAttribute('data-asa-chip')); return }
    const go = e.target.closest('[data-asa-go]')
    if (go) { const cible = go.getAttribute('data-asa-go'); fermer(); if (G('go')) W.go(cible) }
  })
  return ov
}

function feed() { const o = assurerOverlay(); return o.querySelector('#asa-feed') }
function defiler() { const f = feed(); f.scrollTop = f.scrollHeight }

// ─────────────────────────── Bulles ───────────────────────────
function accueil() {
  const chips = AMORCES.map((a) => `<button type="button" class="asa-chip" data-asa-chip="${esc(a)}">${esc(a)}</button>`).join('')
  return `<div class="asa-bot"><div class="asa-a">Bonjour. Une question sur l’utilisation de Propryo ? Par exemple :</div><div class="asa-chips">${chips}</div></div>`
}
function bulleMoi(txt) {
  const d = document.createElement('div'); d.className = 'asa-me'; d.textContent = txt; return d
}
function bulleBot(html, cls) {
  const d = document.createElement('div'); d.className = 'asa-bot' + (cls ? ' ' + cls : ''); d.innerHTML = html; return d
}
function carteReponse(r) {
  if (r.type === 'ok' || r.type === 'faible') {
    const label = LABELS[r.fiche.cible] || r.fiche.cible
    const note = r.type === 'faible' ? '<div class="asa-src">Réponse la plus proche — à reformuler si ce n’est pas ça.</div>' : ''
    const go = `<button type="button" class="asa-go" data-asa-go="${esc(r.fiche.cible)}">${IC_FLECHE} Aller à « ${esc(label)} »</button>`
    return bulleBot(`<div class="asa-a">${r.fiche.reponse}</div>${note}${go}`)
  }
  if (r.type === 'juridique') {
    return bulleBot('<div class="asa-a">Pas de réponse aux questions de droit ou de fiscalité (préavis, plafonds, dépôt de garantie, délais légaux…). Propryo s’appuie sur la loi citée en toutes lettres dans l’écran concerné ; en cas de doute, contacter le support <b>' + SUPPORT + '</b>. Mieux vaut ne pas induire en erreur.</div>', 'asa-alert')
  }
  return bulleBot('<div class="asa-a">Pas de réponse à cette question : seule l’utilisation de Propryo est couverte. Reformuler, ou contacter le support <b>' + SUPPORT + '</b>.</div>', 'asa-alert')
}

function demander(question) {
  try {
    const q = String(question || '').trim(); if (!q) return
    const f = feed()
    f.appendChild(bulleMoi(q))
    f.appendChild(carteReponse(repondre(q)))
    defiler()
  } catch (e) { console.warn('[assistant] demander', e && e.message) }
}
function envoyer() {
  const input = assurerOverlay().querySelector('#asa-q')
  const q = input.value.trim(); if (!q) return
  input.value = ''
  demander(q)
}

// ─────────────────────────── Ouverture / fermeture ───────────────────────────
let _focusAvant = null
function ouvrir() {
  try {
    const ov = assurerOverlay()
    const f = ov.querySelector('#asa-feed')
    if (!f.childElementCount) f.innerHTML = accueil()   // premier accueil ; l'historique de la session est conservé ensuite
    _focusAvant = document.activeElement
    ov.classList.remove('hidden')
    // Le menu « Plus » mobile peut être ouvert : on le referme pour laisser la place au volet.
    try { if (G('_closeMoreSheet')) W._closeMoreSheet() } catch (e) { /* pas de feuille */ }
    setTimeout(() => { const i = ov.querySelector('#asa-q'); if (i) i.focus() }, 50)
  } catch (e) { console.warn('[assistant] ouvrir', e && e.message) }
}
function fermer() {
  const ov = document.getElementById('ov-assistant'); if (!ov) return
  ov.classList.add('hidden')
  try { if (_focusAvant && _focusAvant.focus) _focusAvant.focus() } catch (e) { /* ignoré */ }
}

// ─────────────────────────── Démarrage ───────────────────────────
let _demarre = false
export function demarrer() {
  if (_demarre) return
  _demarre = true
  W.Assistant = { ouvrir, fermer, demander }
}
