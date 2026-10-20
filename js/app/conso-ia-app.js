// js/app/conso-ia-app.js — CONSOMMATION IA : indicateur de l'utilisateur, pause au plafond, écran de l'administrateur.
// Chantier CONSO-IA (GO Didier 16/10/2026), migration 0062, maquette mockups/CONSO-IA/maquette.html.
//
// Chargé par js/main.js dans tous les modes. Sans compte cloud (local, démo) ou sans la migration 0062, il ne montre rien :
// la dictée et les lectures restent celles d'avant (JAMAIS bloquant). Toutes les règles d'affichage : js/core/conso-ia.js.
//  1. Mon profil : « Utilisation de l'IA ce mois-ci » — une ligne d'état, le détail au clic (aucun euro).
//  2. EDL : à 80 % une ligne sous « Dicter la pièce » ; au plafond, « Dictée en pause » + « Saisir à la main ».
//  3. Réglages › Partage (administrateur) : onglets Accès bêta | Consommation IA | Plafonds par offre ; détail d'un compte
//     avec plafond personnalisé. Les droits sont vérifiés EN BASE (is_app_admin) : l'interface ne fait que suivre.
// Signal du client IA (js/core/ia-client.js) : window.__iaConsoSignal({ famille, pct } | { famille, pause, renouvellement }).
import * as C from '../core/conso-ia.js'

const W = window
const G = (n) => (typeof W[n] === 'function' ? W[n] : null)
const esc = (s) => (G('escHtml') ? W.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])))
const ico = (n, s) => (G('_uiIcon') ? W._uiIcon(n, s) : '')
const toast = (m, t, d) => { if (G('showToast')) W.showToast(m, t || 'ok', d) }
const tel = () => (G('_isPhone') ? W._isPhone() : (W.innerWidth || 1280) <= 767)
const api = () => (W.__immoDemo === true ? null : (W.__immoIaConso || null))
const $ = (id) => document.getElementById(id)
const UUID = /^[0-9a-f-]{36}$/
const PLAN_ID = /^[a-z0-9_]{1,40}$/

// ─────────────────────────── État ───────────────────────────
const etat = { usage: null, le: 0, enCours: null, signaux: {}, onglet: 'beta', admin: null, mois: null, offres: null }

/** Relit l'utilisation du mois (au plus une fois par minute, sauf `force`). null : pas de cloud ou migration absente. */
function rafraichir(force) {
  const A = api()
  if (!A) return Promise.resolve(null)
  if (!force && etat.usage && Date.now() - etat.le < 60000) return Promise.resolve(etat.usage)
  if (etat.enCours) return etat.enCours
  etat.enCours = A.monUsage().then((r) => {
    if (r && r.data) { etat.usage = r.data; etat.le = Date.now(); etat.signaux = {} }
    return etat.usage
  }).catch(() => etat.usage).finally(() => { etat.enCours = null })
  return etat.enCours
}
let _rendu = null
function rafraichirEdlPlusTard() {
  if (_rendu) return
  _rendu = setTimeout(() => { _rendu = null; try { if (G('_edlVoixRafraichir')) W._edlVoixRafraichir() } catch (e) { /* rien */ } }, 0)
}
// Signal du client IA : pause annoncée par le relais (429 « mois »), ou part utilisée après un appel réussi.
W.__iaConsoSignal = (x) => {
  if (!x || typeof x.famille !== 'string') return
  etat.signaux[x.famille] = { pause: x.pause === true, pct: Number.isFinite(Number(x.pct)) ? Number(x.pct) : null, renouvellement: x.renouvellement || null }
  // Passé 80 % (ou en pause) : on relit les compteurs pour afficher les vraies minutes ; jamais bloquant.
  if (x.pause === true || Number(x.pct) >= C.SEUIL_AVERTISSEMENT) rafraichir(true).then(rafraichirEdlPlusTard, rafraichirEdlPlusTard)
  else rafraichirEdlPlusTard()
}

function premierDuMoisSuivant() {
  const d = new Date(); const m = d.getMonth() + 1
  return (m === 12 ? d.getFullYear() + 1 : d.getFullYear()) + '-' + String(m === 12 ? 1 : m + 1).padStart(2, '0') + '-01'
}
/** État d'une famille pour le compte connecté : { etat, ligne, renouvellement } (etat null = inconnu). */
function famille(cle) {
  const u = etat.usage
  const ren = (u && u.renouvellement) || null
  const s = etat.signaux[cle]
  if (s && (s.pause || (s.pct != null && s.pct >= 100))) return { etat: 'pause', ligne: null, renouvellement: s.renouvellement || ren || premierDuMoisSuivant() }
  if (!u) return { etat: null, ligne: null, renouvellement: null }
  const ligne = C.lignes(u, { avecVideo: true }).find((l) => l.cle === cle) || null
  return { etat: ligne ? ligne.etat : null, ligne, renouvellement: ren }
}

// ─────────────────────────── EDL : dictée ───────────────────────────
function pauseHtml(cle, renouvellement, pi) {
  const m = C.messagePause(cle, renouvellement)
  return '<div class="cia-pause" role="status"><div class="cia-pause-t">' + ico('pause', 15) + '<b>' + esc(m.titre) + '</b></div>'
    + '<div class="cia-pause-x">' + esc(m.texte) + '</div>'
    + '<div class="cia-pause-a">'
    + (pi != null ? '<button type="button" class="btn bp" onclick="ConsoIa.saisirMain(' + Number(pi) + ')">' + ico('edit', 14) + ' Saisir à la main</button>' : '')
    + '<button type="button" class="btn bs" onclick="ConsoIa.voirUtilisation()">' + ico('chart', 14) + ' Voir l’utilisation</button></div></div>'
}
/** Barre « Dicter la pièce » (téléphone, tablette) : avertissement à 80 %, pause au plafond. */
function barreDictee(pi, barre) {
  const f = famille('dictee')
  if (f.etat === 'pause') return pauseHtml('dictee', f.renouvellement, pi)
  if (f.etat === 'proche' && f.ligne) return barre + '<div class="cia-avert">' + ico('warn', 14) + '<span>' + esc(C.avertissement(f.ligne, f.renouvellement)) + '</span></div>'
  return barre
}
/** Bouton de l'en-tête de pièce (PC) : pastille « en pause » à la place du bouton, ou « 80 % du mois » à côté. */
function boutonDicteePC(pi, bouton) {
  const f = famille('dictee')
  if (f.etat === 'pause') {
    const m = C.messagePause('dictee', f.renouvellement)
    return '<button type="button" class="cia-pc-pause" title="' + esc(m.texte) + '" onclick="ConsoIa.voirUtilisation()">' + ico('pause', 13) + ' ' + esc(m.titre) + '</button>'
  }
  if (f.etat === 'proche' && f.ligne) return bouton + '<span class="cia-pc-avert" title="' + esc(C.avertissement(f.ligne, f.renouvellement)) + '">' + ico('warn', 13) + ' ' + f.ligne.pct + ' % du mois</span>'
  return bouton
}
/** « Saisir à la main » : la première zone de saisie de la pièce reçoit le focus. */
function saisirMain(pi) {
  const slot = document.querySelector('#ov-edl .evx-slot[data-evx-pi="' + Number(pi) + '"]')
  const bloc = (slot && slot.closest('.edl-piece-block')) || document.querySelector('#ov-edl .edl-piece-block[data-pidx="' + Number(pi) + '"]')
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  // Première commande VISIBLE des éléments de la pièce (état, observation) ; à défaut, n'importe quelle saisie de la pièce.
  // Ordre : l'observation du premier élément (la saisie la plus utile), puis tout autre champ ou état de la pièce.
  const champs = bloc ? [...bloc.querySelectorAll('textarea'), ...bloc.querySelectorAll('tbody tr input:not([type=hidden]):not([type=file]), select, button[aria-label]')] : []
  const champ = champs.find(visible)
  if (champ) { try { champ.scrollIntoView({ block: 'center', behavior: 'smooth' }); champ.focus({ preventScroll: true }) } catch (e) { /* rien */ } return }
  toast('Saisir les éléments de la pièce ci-dessous.', 'info')
}

// ─────────────────────────── Lignes (profil, détail) ───────────────────────────
function lignesHtml(ls) {
  return ls.map((l) => {
    const unite = l.unite === 'min' ? ' min' : ''
    const v = l.plafond == null ? (l.utilise ? l.utilise + unite + ' · ' : '') + 'sans plafond' : l.utilise + unite + ' sur ' + l.plafond + (l.unite === 'min' ? ' min' : ' ' + l.unite)
    const pct = l.pct == null ? 0 : Math.min(100, l.pct)
    return '<div class="cia-lim ' + l.etat + '"><span class="nm">' + esc(l.libelle) + '</span><span class="v">' + esc(v) + '</span>'
      + '<span class="cia-track"><i style="width:' + pct + '%"></i></span>'
      + (l.gestes ? '<span class="eq">' + esc(l.gestes) + '</span>' : '') + '</div>'
  }).join('')
}

// ─────────────────────────── Mon profil ───────────────────────────
async function carteProfil(mount) {
  if (!mount || !api()) return
  const u = await rafraichir(true)
  if (!u || !mount.isConnected) { mount.innerHTML = ''; return }
  const p = C.phraseEtat(u)
  const nom = (u.plafonds && (u.plafonds.nom || u.plafonds.offre)) || ''
  mount.innerHTML = '<div class="ct mb12" style="font-size:14px">' + ico('sparkle', 15) + ' Utilisation de l’IA ce mois-ci</div>'
    + '<div class="cia-carte"><div class="cia-l1"><span class="cia-etat ' + p.etat + '">' + ico(p.etat === 'ok' ? 'check-circle' : p.etat === 'pause' ? 'pause' : 'warn', 15) + ' ' + esc(p.titre) + '</span>'
    + '<span class="cia-mu">' + esc(p.texte) + '</span>'
    + '<button type="button" class="btn bs bb cia-plus" aria-expanded="false" onclick="ConsoIa.basculerDetail(this)">' + ico('chevron-right', 14) + ' Voir le détail</button></div>'
    + '<div class="cia-detail" hidden>' + lignesHtml(C.lignes(u)) + '<p class="cia-note">' + (nom ? 'Offre ' + esc(nom) + ' · ' : '') + 'remise à zéro le ' + esc(C.dateCourte(u.renouvellement)) + '. La saisie manuelle reste toujours possible, même quand une fonction IA est en pause.</p></div></div>'
}
function basculerDetail(btn) {
  const d = btn && btn.closest('.cia-carte') && btn.closest('.cia-carte').querySelector('.cia-detail'); if (!d) return
  d.hidden = !d.hidden
  btn.setAttribute('aria-expanded', d.hidden ? 'false' : 'true')
  btn.innerHTML = ico(d.hidden ? 'chevron-right' : 'chevron-left', 14) + (d.hidden ? ' Voir le détail' : ' Masquer le détail')
}
/** Depuis l'EDL : l'utilisation du mois dans une couche (page entière au téléphone), sans quitter l'état des lieux. */
async function voirUtilisation() {
  const u = await rafraichir(true)
  const corps = u ? '<div class="cia-l1"><span class="cia-etat ' + C.phraseEtat(u).etat + '">' + esc(C.phraseEtat(u).titre) + '</span><span class="cia-mu">' + esc(C.phraseEtat(u).texte) + '</span></div>' + lignesHtml(C.lignes(u))
      + '<p class="cia-note">La saisie manuelle reste toujours possible, même quand une fonction IA est en pause.</p>'
    : '<p class="cia-note">Utilisation indisponible pour le moment.</p>'
  couche('ov-cia-usage', 'Utilisation de l’IA ce mois-ci', u && u.plafonds ? 'Offre ' + (u.plafonds.nom || u.plafonds.offre) : '', corps,
    '<button type="button" class="btn bp" onclick="closeM(\'ov-cia-usage\')">Fermer</button>')
}
function couche(id, titre, sous, corps, pied) {
  let ov = $(id)
  if (!ov) { ov = document.createElement('div'); ov.className = 'ov hidden'; ov.id = id; document.body.appendChild(ov) }
  ov.innerHTML = '<div class="modal cia-modal" role="dialog" aria-modal="true" aria-label="' + esc(titre) + '">'
    + '<div class="m-head"><h3>' + esc(titre) + (sous ? '<small>' + esc(sous) + '</small>' : '') + '</h3><button type="button" class="m-close" onclick="closeM(\'' + id + '\')" aria-label="Fermer">✕</button></div>'
    + '<div class="m-body">' + corps + '</div><div class="m-foot">' + pied + '</div></div>'
  if (G('openM')) W.openM(id); else ov.classList.remove('hidden')
}

// ─────────────────────────── Administrateur ───────────────────────────
const ONGLETS = [['beta', 'Accès bêta'], ['conso', 'Consommation IA'], ['offres', 'Plafonds par offre']]
function ongletAdmin() { return etat.onglet }
function adminOnglets() {
  const m = $('adm-onglets'); if (!m) return
  m.innerHTML = '<div class="cia-adm-hd"><div class="ct" style="margin:0">' + ico('shield', 16) + ' Administration</div><span class="cia-badge">réservé à l’administrateur</span></div>'
    + '<div class="cia-tabs" role="tablist">' + ONGLETS.map(([k, t]) => '<button type="button" role="tab" class="cia-tab' + (k === etat.onglet ? ' on' : '') + '" aria-selected="' + (k === etat.onglet) + '" onclick="ConsoIa.choisirOnglet(\'' + k + '\')">' + esc(t) + '</button>').join('') + '</div>'
  afficherOnglet()
}
function choisirOnglet(k) {
  if (!ONGLETS.some((o) => o[0] === k)) return
  etat.onglet = k
  adminOnglets()
  if (k === 'beta' && G('_renderBetaAdmin')) W._renderBetaAdmin()
}
function afficherOnglet() {
  const b = $('beta-admin-mount'), ia = $('adm-ia-mount'); if (!b || !ia) return
  b.hidden = etat.onglet !== 'beta'
  ia.hidden = etat.onglet === 'beta'
  if (etat.onglet === 'conso') renderConso(etat.mois)
  else if (etat.onglet === 'offres') renderOffres()
}
function messageAdmin(r) {
  if (r && r.absent) return 'La consommation s’affichera quand la migration 0062 sera appliquée.'
  if (r && r.error === 'interdit') return 'Réservé à l’administrateur.'
  return 'Consommation indisponible pour le moment. Réessayer plus tard.'
}
const moisDecale = (iso, n) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso || '')); if (!m) return null; const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1)); return d.toISOString().slice(0, 10) }

async function renderConso(mois) {
  const mount = $('adm-ia-mount'); const A = api(); if (!mount) return
  if (!A) { mount.innerHTML = '<div class="card cia-vide">Consommation disponible avec un compte connecté.</div>'; return }
  mount.innerHTML = '<div class="card cia-vide">' + ico('hourglass', 15) + ' Chargement de la consommation…</div>'
  const r = await A.adminConso(mois || null)
  if (etat.onglet !== 'conso' || !mount.isConnected) return
  if (!r || !r.data) { mount.innerHTML = '<div class="card cia-vide">' + esc(messageAdmin(r)) + '</div>'; return }
  const S = C.syntheseAdmin(r.data)
  etat.admin = S; etat.mois = S.mois
  const courant = String(r.data.aujourdhui || '').slice(0, 7) === S.mois.slice(0, 7)
  const tete = '<div class="cia-etatl"><div class="cia-v"><b>' + esc(C.euros(S.total)) + '</b><span>estimés ' + (courant ? 'ce mois-ci' : 'sur le mois') + '</span></div><span class="cia-sep"></span>'
    + '<div class="cia-v"><b class="m">' + esc(S.appels.toLocaleString('fr-FR')) + '</b><span>appels · ' + S.actifs + ' compte' + (S.actifs > 1 ? 's' : '') + ' actif' + (S.actifs > 1 ? 's' : '') + '</span></div>'
    + '<div class="cia-mois"><button type="button" class="btn bs" aria-label="Mois précédent" onclick="ConsoIa.mois(\'' + moisDecale(S.mois, -1) + '\')">' + ico('chevron-left', 15) + '</button><span>' + esc(C.moisLong(S.mois)) + '</span>'
    + '<button type="button" class="btn bs" aria-label="Mois suivant" ' + (courant ? 'disabled' : '') + ' onclick="ConsoIa.mois(\'' + moisDecale(S.mois, 1) + '\')">' + ico('chevron-right', 15) + '</button></div></div>'
  const regarder = S.aRegarder.length ? '<div class="card cia-card"><h4>' + ico('warn', 15) + ' À regarder <span class="rt">' + new Set(S.aRegarder.map((x) => x.userId)).size + ' compte(s)</span></h4>'
    + S.aRegarder.map((x) => '<button type="button" class="cia-alerte ' + (x.etat === 'pause' ? 'ps' : '') + '" data-uid="' + esc(x.userId) + '" onclick="ConsoIa.ouvrirCompte(this.dataset.uid)">' + ico(x.etat === 'pause' ? 'pause' : 'warn', 15)
      + '<span><b>' + esc(x.email) + '</b> : ' + esc(x.libelle.charAt(0).toLowerCase() + x.libelle.slice(1)) + (x.etat === 'pause' ? ' en pause' : ' à ' + x.pct + ' %') + ' (' + x.utilise + ' sur ' + x.plafond + (x.unite === 'min' ? ' min' : ' ' + x.unite) + ')</span><span class="go">Voir ' + ico('chevron-right', 13) + '</span></button>').join('') + '</div>' : ''
  const maxF = Math.max(1, ...S.fonctions.map((f) => f.cout))
  const fonctions = '<div class="card cia-card"><h4>Par fonction <span class="rt">coût estimé</span></h4>' + S.fonctions.map((f) => '<div class="cia-fn' + (f.off ? ' off' : '') + '"><span class="nm">' + esc(f.libelle) + (f.off ? ' <span class="cia-off">éteint</span>' : '') + '</span><span class="eur">' + (f.off ? '—' : esc(C.euros(f.cout))) + '</span>'
    + '<span class="u">' + esc(f.off ? 'allumage prévu plus tard' : f.detail) + '</span><span></span><span class="cia-track"><i style="width:' + Math.round(f.cout / maxF * 100) + '%"></i></span></div>').join('') + '</div>'
  const jours = '<div class="card cia-card"><h4>Jour par jour <span class="rt">coût estimé, en euros</span></h4>' + graphique(S.jours) + '<div class="cia-leg">' + (S.jours.length ? 'Du 1er au ' + S.jours.length + ' ' + esc(C.moisLong(S.mois).split(' ')[0].toLowerCase()) + '.' + (courant ? ' Barre foncée : aujourd’hui.' : '') : 'Aucun jour.') + '</div></div>'
  const comptes = S.comptes.length ? (tel() ? S.comptes.map((c) => '<div role="button" tabindex="0" class="cia-ac" data-uid="' + esc(c.userId) + '" onclick="ConsoIa.ouvrirCompte(this.dataset.uid)" onkeydown="if(event.key===\'Enter\')ConsoIa.ouvrirCompte(this.dataset.uid)"><div class="l1"><b>' + esc(c.email) + '</b><span class="eur">' + esc(C.euros(c.cout)) + '</span>' + ico('chevron-right', 14) + '</div>'
      + '<div class="l2">' + badge(c) + '<span class="fp">' + esc(c.fonctionPrincipale) + '</span><span class="cia-pct">' + mini(c) + '</span></div></div>').join('')
    : '<table class="cia-tbl"><thead><tr><th>Compte</th><th>Offre</th><th class="r">Ce mois</th><th>Plafond le plus haut</th><th>État</th></tr></thead><tbody>'
      + S.comptes.map((c) => '<tr tabindex="0" data-uid="' + esc(c.userId) + '" onclick="ConsoIa.ouvrirCompte(this.dataset.uid)" onkeydown="if(event.key===\'Enter\')ConsoIa.ouvrirCompte(this.dataset.uid)"><td>' + esc(c.email) + '<div class="cia-mu">' + esc(c.fonctionPrincipale) + '</div></td><td>' + esc(c.offre) + (c.surcharge ? ' · personnalisé' : '') + '</td><td class="r">' + esc(C.euros(c.cout)) + '</td><td>' + mini(c) + (c.familleMax ? '<div class="cia-mu">' + esc(c.familleMax) + '</div>' : '') + '</td><td>' + badge(c) + '</td></tr>').join('')
      + '</tbody></table>')
    : '<div class="cia-mu">Aucune consommation ce mois-ci.</div>'
  mount.innerHTML = tete + regarder + '<div class="cia-g2">' + jours + fonctions + '</div>'
    + '<div class="card cia-card"><h4>Par compte <span class="rt">' + S.comptes.length + ' compte' + (S.comptes.length > 1 ? 's' : '') + ' · tri par coût</span></h4>' + comptes + '</div>'
    + '<p class="cia-note">Coût estimé avec la grille de prix du fournisseur relevée le 16/10/2026. Aucune donnée de locataire ni de candidat : seulement des compteurs.</p>'
}
function badge(c) {
  if (c.etat === 'pause') return '<span class="cia-b p">' + ico('pause', 12) + ' En pause</span>'
  if (c.etat === 'proche') return '<span class="cia-b w">' + ico('warn', 12) + ' Proche</span>'
  if (c.sansPlafond) return '<span class="cia-b">Sans plafond</span>'
  return '<span class="cia-b ok">Normal</span>'
}
function mini(c) {
  if (c.pct == null) return '<span class="cia-mu">—</span>'
  return '<span class="cia-mini ' + (c.etat === 'pause' ? 'p' : c.etat === 'proche' ? 'w' : '') + '"><i style="width:' + Math.min(100, c.pct) + '%"></i></span><span class="num">' + c.pct + ' %</span>'
}
function graphique(jours) {
  const W2 = tel() ? 340 : 640, H = 170, pl = 44, pb = 22, pt = 8
  const max = Math.max(0.2, ...jours.map((j) => j.cout / 1e6))
  const pas = max <= 0.2 ? 0.05 : max <= 1 ? 0.2 : max <= 5 ? 1 : Math.ceil(max / 5)
  const haut = Math.ceil(max / pas) * pas
  const n = Math.max(1, jours.length), bw = (W2 - pl - 6) / n
  let s = '<svg class="cia-chart" viewBox="0 0 ' + W2 + ' ' + H + '" role="img" aria-label="Coût estimé par jour">'
  for (let v = 0; v <= haut + 1e-9; v += pas) {
    const y = pt + (H - pt - pb) * (1 - v / haut)
    s += '<line class="' + (v ? 'g' : 'a') + '" x1="' + pl + '" x2="' + (W2 - 2) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text x="' + (pl - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + v.toFixed(2).replace('.', ',') + ' €</text>'
  }
  const tous = tel() ? 5 : 3
  jours.forEach((j, i) => {
    const h = (H - pt - pb) * ((j.cout / 1e6) / haut), x = pl + i * bw + 1.5, y = H - pb - h
    s += '<rect class="' + (i === n - 1 ? 'hi' : 'b') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, bw - 3).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="2"><title>' + esc(j.jour.slice(8) + ' : ' + C.euros(j.cout)) + '</title></rect>'
    if (i === 0 || (i + 1) % tous === 0 || i === n - 1) s += '<text x="' + (x + (bw - 3) / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + (i + 1) + '</text>'
  })
  return s + '</svg>'
}
function mois(iso) { if (/^\d{4}-\d{2}-01$/.test(String(iso || ''))) { etat.mois = iso; renderConso(iso) } }

// Détail d'un compte et plafond personnalisé.
const CHAMPS = [['dictee', 'Dictée d’EDL (min / mois)', 'dictee_min'], ['pieces', 'Lecture des pièces (pages)', 'pieces_pages'], ['liens', 'Locataire et artisan (demandes)', 'liens_demandes'], ['factures', 'Lecture de factures', 'factures']]
function ouvrirCompte(userId) {
  const S = etat.admin; if (!S || !UUID.test(String(userId))) return
  const c = S.comptes.find((x) => x.userId === userId); if (!c) return
  const sd = c.surchargeDetail || null
  const actif = sd && (!sd.jusqu_au || String(sd.jusqu_au) >= new Date().toISOString().slice(0, 10))
  const mode = !sd ? 'offre' : sd.sans_plafond ? 'sans' : 'perso'
  // Champ vide = valeur de l'offre (rien n'est figé) ; seule une valeur saisie devient un plafond propre au compte.
  const val = (k, col) => (sd && !sd.sans_plafond && sd[col] != null ? sd[col] : '')
  const actuel = (k) => { const p = c.plafonds || {}; if (sd || p.sans_plafond || p[k] == null) return 'valeur de l’offre'; return 'offre : ' + (k === 'dictee' ? Math.round(p[k] / 60) : p[k]) }
  const radio = (v, t, d) => '<label class="cia-radio' + (mode === v ? ' on' : '') + '"><input type="radio" name="cia-mode" value="' + v + '"' + (mode === v ? ' checked' : '') + ' onchange="ConsoIa.modeCompte(this)"><span>' + esc(t) + '</span>' + (d ? '<span class="cia-mu">' + esc(d) + '</span>' : '') + '</label>'
  const corps = lignesHtml(c.lignes)
    + '<div class="cia-h4">Plafonds de ce compte</div><div class="cia-radios">'
    + radio('offre', 'Plafonds de l’offre ' + c.offre, '') + radio('perso', 'Plafonds personnalisés', '') + radio('sans', 'Sans plafond', '') + '</div>'
    + '<div class="cia-champs" id="cia-champs"' + (mode === 'perso' ? '' : ' hidden') + '>' + CHAMPS.map(([k, t, col]) => '<label for="cia-f-' + k + '">' + esc(t) + '</label><input class="inp cia-n" id="cia-f-' + k + '" inputmode="numeric" value="' + esc(val(k, col)) + '" placeholder="' + esc(actuel(k)) + '">').join('') + '</div>'
    + '<div class="cia-champs" id="cia-champs2"' + (mode === 'offre' ? ' hidden' : '') + '><label for="cia-f-motif">Motif</label><input class="inp" id="cia-f-motif" maxlength="200" value="' + esc((sd && sd.motif) || '') + '" placeholder="ex : testeur d’EDL">'
    + '<label for="cia-f-fin">Jusqu’au (inclus)</label><input class="inp" id="cia-f-fin" type="date" value="' + esc((sd && sd.jusqu_au) || '') + '"></div>'
    + (sd && !actif ? '<p class="cia-note">La surcharge précédente a pris fin le ' + esc(String(sd.jusqu_au)) + ' : le compte suit les plafonds de son offre.</p>' : '')
    + '<p class="cia-note">À la date de fin, le compte revient aux plafonds de son offre. Chaque changement est inscrit au journal d’administration.</p>'
  etat.compte = userId
  couche('ov-cia-compte', c.email, 'Offre ' + c.offre + ' · ' + C.moisLong(S.mois).toLowerCase() + ' : ' + C.euros(c.cout), corps,
    '<button type="button" class="btn bs" onclick="closeM(\'ov-cia-compte\')">Annuler</button><button type="button" class="btn bp" onclick="ConsoIa.enregistrerCompte()">' + ico('save', 14) + ' Enregistrer</button>')
}
function modeCompte(inp) {
  const v = inp && inp.value
  document.querySelectorAll('#ov-cia-compte .cia-radio').forEach((l) => l.classList.toggle('on', !!l.querySelector('input:checked')))
  const a = $('cia-champs'), b = $('cia-champs2'); if (a) a.hidden = v !== 'perso'; if (b) b.hidden = v === 'offre'
}
async function enregistrerCompte() {
  const A = api(); const userId = etat.compte; if (!A || !UUID.test(String(userId || ''))) return
  const c = etat.admin && etat.admin.comptes.find((x) => x.userId === userId)
  const choix = document.querySelector('#ov-cia-compte input[name="cia-mode"]:checked'); const mode = choix ? choix.value : 'offre'
  let r
  if (mode === 'offre') {
    r = c && c.surchargeDetail ? await A.adminSurchargeRetirer(userId) : { data: null }
  } else {
    const v = { sansPlafond: mode === 'sans', motif: ($('cia-f-motif') || {}).value || '', jusquAu: ($('cia-f-fin') || {}).value || null }
    for (const [k] of CHAMPS) {
      if (mode === 'sans') { v[k] = null; continue }
      const x = C.lirePlafond(($('cia-f-' + k) || {}).value)
      if (x === undefined) { toast('Plafond invalide : un nombre entier, ou vide pour garder la valeur de l’offre.', 'warn', 5000); return }
      v[k] = x
    }
    v.video = null
    r = await A.adminSurchargeMaj(userId, v)
  }
  if (!r || r.error) { toast(r && r.error === 'interdit' ? 'Réservé à l’administrateur.' : 'Enregistrement impossible pour le moment.', 'warn', 5000); return }
  if (G('closeM')) W.closeM('ov-cia-compte')
  toast('Plafonds du compte enregistrés', 'ok')
  renderConso(etat.mois)
}

// Plafonds par offre (modifiables sans redéployer).
const COLS = [['dictee', 'dictee_min', 'Dictée d’EDL', 'min / mois'], ['pieces', 'pieces_pages', 'Lecture des pièces', 'pages'], ['liens', 'liens_demandes', 'Locataire et artisan', 'demandes'], ['factures', 'factures', 'Factures', 'lectures']]
async function renderOffres() {
  const mount = $('adm-ia-mount'); const A = api(); if (!mount) return
  if (!A) { mount.innerHTML = '<div class="card cia-vide">Plafonds disponibles avec un compte connecté.</div>'; return }
  mount.innerHTML = '<div class="card cia-vide">' + ico('hourglass', 15) + ' Chargement des plafonds…</div>'
  const r = await A.adminPlafonds()
  if (etat.onglet !== 'offres' || !mount.isConnected) return
  if (!r || !Array.isArray(r.data)) { mount.innerHTML = '<div class="card cia-vide">' + esc(messageAdmin(r)) + '</div>'; return }
  etat.offres = r.data.filter((o) => PLAN_ID.test(String(o.plan_id)))
  const prix = (o) => (o.prix_cents == null ? 'non commercialisée' : o.prix_cents === 0 ? '0 €' : (o.prix_cents / 100).toFixed(2).replace('.', ',') + ' €') + (o.limite_biens ? ' · ' + (o.limite_biens === 1 ? '1 lot' : '≤ ' + o.limite_biens + ' lots') : '')
  const champ = (o, k, col) => '<input class="inp cia-n" inputmode="numeric" aria-label="' + esc(o.nom + ' : ' + k) + '" data-plan="' + esc(o.plan_id) + '" data-k="' + k + '" value="' + (o[col] == null ? '' : esc(o[col])) + '" placeholder="sans" oninput="ConsoIa.offreModifiee(this)">'
  const cout = (o) => { const v = C.coutMaxOffre({ dictee: o.dictee_min, pieces: o.pieces_pages, liens: o.liens_demandes, factures: o.factures }); return v == null ? 'sans plafond' : C.euros(v) }
  const corps = (tel() || (W.innerWidth || 1280) < 1100)
    ? etat.offres.map((o) => '<div class="cia-oc"><div class="l1"><b>' + esc(o.nom) + '</b><span class="cia-mu">' + esc(prix(o)) + '</span><span class="cout" data-cout="' + esc(o.plan_id) + '">max ' + esc(cout(o)) + '</span></div>'
        + COLS.map(([k, col, t, u]) => '<label class="kv"><span>' + esc(t) + ' <span class="cia-mu">' + esc(u) + '</span></span>' + champ(o, k, col) + '</label>').join('') + '</div>').join('')
    : '<table class="cia-of"><thead><tr><th>Offre</th>' + COLS.map(([, , t, u]) => '<th>' + esc(t) + '<br>' + esc(u) + '</th>').join('') + '<th>Coût max<br>par compte</th></tr></thead><tbody>'
      + etat.offres.map((o) => '<tr><td><b>' + esc(o.nom) + '</b><span class="px">' + esc(prix(o)) + '</span></td>'
        + COLS.map(([k, col]) => '<td>' + champ(o, k, col) + (k === 'dictee' || k === 'pieces' ? '<span class="eq" data-eq="' + esc(o.plan_id) + ':' + k + '">' + esc(C.gestesOffre(k, o[col])) + '</span>' : '') + '</td>').join('')
        + '<td class="cout" data-cout="' + esc(o.plan_id) + '">' + esc(cout(o)) + '</td></tr>').join('') + '</tbody></table>'
  mount.innerHTML = '<div class="card cia-card"><div class="cia-ofhd"><div class="cia-mu">Plafonds mensuels par compte. Vide = sans plafond. Un changement s’applique au prochain appel, sans redéploiement.</div><button type="button" class="btn bp" onclick="ConsoIa.enregistrerOffres()">' + ico('save', 14) + ' Enregistrer</button></div>'
    + corps + '<p class="cia-note">Coût max = tous les plafonds consommés, au prix du fournisseur relevé le 16/10/2026. Garde-fou journalier par compte, quelle que soit l’offre : 60 min de dictée et 200 appels par jour.</p></div>'
}
function valeursOffre(plan) {
  const v = {}
  document.querySelectorAll('#adm-ia-mount input[data-plan="' + plan + '"]').forEach((i) => { v[i.getAttribute('data-k')] = C.lirePlafond(i.value) })
  return v
}
function offreModifiee(inp) {
  const plan = inp && inp.getAttribute('data-plan'); if (!PLAN_ID.test(String(plan))) return
  const v = valeursOffre(plan)
  inp.classList.toggle('err', C.lirePlafond(inp.value) === undefined)
  const c = document.querySelector('#adm-ia-mount [data-cout="' + plan + '"]')
  if (c && Object.values(v).every((x) => x !== undefined)) { const m = C.coutMaxOffre(v); c.textContent = (tel() ? 'max ' : '') + (m == null ? 'sans plafond' : C.euros(m)) }
  for (const k of ['dictee', 'pieces']) { const e = document.querySelector('#adm-ia-mount [data-eq="' + plan + ':' + k + '"]'); if (e && v[k] !== undefined) e.textContent = C.gestesOffre(k, v[k]) }
}
async function enregistrerOffres() {
  const A = api(); if (!A || !etat.offres) return
  const COL = { dictee: 'dictee_min', pieces: 'pieces_pages', liens: 'liens_demandes', factures: 'factures' }
  const changes = []
  for (const o of etat.offres) {
    const v = valeursOffre(o.plan_id)
    if (Object.values(v).some((x) => x === undefined)) { toast('Plafond invalide pour « ' + o.nom + ' » : un nombre entier, ou vide (sans plafond).', 'warn', 5000); return }
    if (Object.keys(COL).some((k) => (v[k] == null ? null : v[k]) !== (o[COL[k]] == null ? null : Number(o[COL[k]])))) changes.push([o, { ...v, video: o.video_images == null ? null : Number(o.video_images) }])
  }
  if (!changes.length) { toast('Aucun changement.', 'info'); return }
  for (const [o, v] of changes) {
    const r = await A.adminPlafondsMaj(o.plan_id, v)
    if (!r || r.error) { toast('Enregistrement impossible pour « ' + o.nom + ' ».', 'warn', 5000); return }
  }
  toast(changes.length > 1 ? changes.length + ' offres mises à jour' : 'Offre « ' + changes[0][0].nom + ' » mise à jour', 'ok')
  renderOffres()
}

W.ConsoIa = {
  rafraichir, famille, barreDictee, boutonDicteePC, saisirMain, voirUtilisation, carteProfil, basculerDetail,
  adminOnglets, ongletAdmin, choisirOnglet, mois, ouvrirCompte, modeCompte, enregistrerCompte, offreModifiee, enregistrerOffres,
}
export function demarrer() { /* l'utilisation est lue à la demande (profil, ouverture d'un EDL) : rien au démarrage */ }
