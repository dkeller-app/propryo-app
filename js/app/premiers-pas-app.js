// js/app/premiers-pas-app.js — ACCUEIL D'UN NOUVEL UTILISATEUR : carte « Premiers pas » + visite guidée.
// CDC : docs/CDC-PREMIERS-PAS.md (option C, GO Didier 15/10/2026, D1 → D15). Maquette : mockups/PREMIERS-PAS.
//
// Chargé par js/main.js dans tous les modes (local, cloud, démo), comme le circuit d'un incident. Rôles :
//  1. carte « Premiers pas » de l'Accueil (PC/tablette : en tête de #pil-root, indépendante de la matrice ;
//     téléphone : dans #accm-phone) — appelée par rAccueil via window.PremiersPas.carte() ;
//  2. couche « toutes les étapes » ; 3. visite guidée (bulle d'accueil + 6 étapes), relance depuis Mon profil ;
//  4. progression enregistrée dans DB.params.premiersPas (clé privée, D5), opposition à la mesure (D6).
// Toutes les décisions (étapes, détection, dates, repli, placement) : module pur js/core/premiers-pas.js.
// Jamais bloquant : toute erreur ici est avalée, l'Accueil s'affiche toujours.
import * as PP from '../core/premiers-pas.js'

const W = window
const G = (n) => (typeof W[n] === 'function' ? W[n] : null)
const db = () => { try { return DB } catch (e) { return null } }   // eslint-disable-line no-undef
const donneesPretes = () => { try { return _bootDataJobsDone === true } catch (e) { return false } }   // eslint-disable-line no-undef
const lectureSeule = () => { try { return !!_appReadOnly } catch (e) { return false } }   // eslint-disable-line no-undef
const pageCourante = () => { try { return currentPage } catch (e) { return null } }   // eslint-disable-line no-undef
const esc = (s) => (G('escHtml') ? W.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])))
const ico = (n, s) => (G('_uiIcon') ? W._uiIcon(n, s) : '')
const toast = (m, t, d) => { if (G('showToast')) W.showToast(m, t || 'ok', d) }
const tel = () => (G('_isPhone') ? W._isPhone() : (W.innerWidth || 1280) <= 767)
const maintenant = () => new Date().toISOString()
const vivant = (o) => o && !o._deleted
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' }
const ID_ETAPE = /^[a-z]+$/   // les seules valeurs passées aux on…= : identifiants fixes du module pur

// ─────────────────────────── Ce que l'app ne sait qu'avec le cloud ───────────────────────────
const ext = { invitations: null, lectureInvitations: false }
function extActuel() {
  const cloud = !!(W.__immoSupabaseMode || W.__immoDemo)
  let espacePropre
  try { const a = W.__immoEspaceLoc; if (a && a.pret && a.pret() && a.espacePropre) espacePropre = a.espacePropre() || undefined } catch (e) { /* pas prêt */ }
  let acces = null
  try { if (W.EspaceLoc && typeof W.EspaceLoc.nbAccesEmis === 'function') acces = W.EspaceLoc.nbAccesEmis() } catch (e) { /* pas prêt */ }
  return { cloud, espacePropre, accesLocataire: acces, invitations: ext.invitations }
}
// Invitations déjà créées (comptes antérieurs à la fonction) : UNE lecture, après l'affichage, jamais bloquante (D4).
function lireInvitationsPlusTard() {
  // Pas avant les données du compte : avant la connexion, l'espace n'est pas résolu et la lecture rendrait null.
  if (ext.lectureInvitations || !donneesPretes()) return
  const P = W.__immoPartage
  if (!P || typeof P.compterInvitations !== 'function') return
  ext.lectureInvitations = true
  setTimeout(() => {
    P.compterInvitations().then((n) => {
      // null = espace pas encore résolu : on relira au prochain affichage (l'attente reste bornée à ATTENTE_MAX).
      if (typeof n !== 'number') { ext.lectureInvitations = false; return }
      ext.invitationsLues = true
      if (n !== ext.invitations) ext.invitations = Math.max(n, ext.invitations || 0)
      rafraichir()
    }).catch(() => { ext.lectureInvitations = false })
  }, 1200)
}
// En cloud, la PREMIÈRE évaluation attend les deux compteurs (accès locataire chargés ~1,5 s après la connexion,
// invitations lues ensuite) : sinon un compte antérieur verrait ses étapes cloud datées « maintenant », sans « avant »,
// et fausserait les statistiques. Au plus ATTENTE_MAX ms, puis on évalue avec ce qui est connu (jamais bloquant).
const ATTENTE_MAX = 12000
function comptesConnus(x, etat) {
  if (!x.cloud || W.__immoDemo) return true
  if (!ext.attenteDepuis) ext.attenteDepuis = Date.now()
  if (Date.now() - ext.attenteDepuis > ATTENTE_MAX) return true
  const partage = W.__immoPartage && typeof W.__immoPartage.compterInvitations === 'function'
  // Sans bail propre, aucun accès locataire n'est possible : inutile d'attendre leur chargement (compte neuf).
  const bail = etat && etat.liste.find((s) => s.id === 'bail')
  const accesConnu = x.accesLocataire !== null || !(bail && bail.fait)
  return accesConnu && (!partage || ext.invitationsLues === true)
}
let _attente = null
function reessayerBientot() { if (_attente) return; _attente = setTimeout(() => { _attente = null; rafraichir() }, 1500) }
// Une invitation créée maintenant coche l'étape aussitôt (sans attendre la lecture).
function brancherInvitation() {
  const P = W.__immoPartage
  if (!P || typeof P.createInvite !== 'function' || P.createInvite.__premiersPas) return
  const orig = P.createInvite
  P.createInvite = async function (...a) {
    const r = await orig.apply(this, a)
    if (r && r.token) { ext.invitations = (ext.invitations || 0) + 1; rafraichir() }
    return r
  }
  P.createInvite.__premiersPas = true
}

// ─────────────────────────── Progression (D5, D6) ───────────────────────────
let _ecriture = false
function lirePP() { const D = db(); return (D && D.params && D.params.premiersPas) || null }
function enregistrer(pp) {
  const D = db(); if (!D || _ecriture) return
  if (!D.params) D.params = {}
  D.params.premiersPas = pp
  if (W.__immoHorsLigne || lectureSeule() || !G('saveDB')) return   // gardé en mémoire ; réécrit au prochain affichage en ligne
  _ecriture = true
  try { W.saveDB({ autosave: true, quoi: 'premiers-pas' }) } catch (e) { console.warn('[premiers-pas] enregistrement', e && e.message) } finally { _ecriture = false }
}
/** Évalue la liste et met la progression à jour. null tant que les données du compte ne sont pas chargées. */
function evaluer() {
  const D = db(); if (!D) return null
  const x = extActuel()
  const etat = PP.etapesPremiersPas(D, x)
  let pp = lirePP()
  if (!pp) {
    if (!donneesPretes() || W.__immoHorsLigne) return { etat, pp: null, x }
    if (!comptesConnus(x, etat)) { lireInvitationsPlusTard(); reessayerBientot(); return { etat, pp: null, x } }
    pp = PP.initialiser(D, x, maintenant())
    enregistrer(pp)
    return { etat, pp, x }
  }
  if (donneesPretes()) {
    const r = PP.majProgression(pp, etat, maintenant())
    if (r.change) { pp = r.pp; enregistrer(pp) }
  }
  return { etat, pp, x }
}

// ─────────────────────────── Styles (jetons de l'app : sobre et dark) ───────────────────────────
const CSS = `
#pp-carte{background:var(--sur);border:1px solid var(--bor);border-radius:16px;padding:10px 12px 10px 16px;margin:0 0 12px;box-shadow:var(--shadow-card)}
#pp-carte .pp-l1{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#pp-carte .pp-tb{display:flex;flex-direction:column;gap:4px;flex:none;min-width:150px}
#pp-carte .pp-t{font-family:'Schibsted Grotesk','Inter',sans-serif;font-weight:800;font-size:15px;color:var(--t1);display:flex;align-items:center;gap:8px;white-space:nowrap;margin:0}
#pp-carte .pp-n{font-size:13px;font-weight:700;color:var(--t2);white-space:nowrap}
#pp-carte .pp-bar{display:block;width:130px;height:7px;border-radius:4px;background:var(--bor);overflow:hidden}
#pp-carte .pp-bar>i{display:block;height:100%;background:var(--pos);border-radius:4px}
#pp-carte .pp-next{flex:1 1 260px;min-width:0;font-size:13.5px;color:var(--t2)}
#pp-carte .pp-next b{color:var(--t1)}
#pp-carte .pp-act{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-left:auto}
#pp-carte .pp-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 auto;min-width:0;list-style:none;margin:0;padding:0}
.pp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 14px;border-radius:10px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;border:1px solid var(--bor);background:var(--sur);color:var(--t1);white-space:nowrap}
.pp-btn.pri{background:var(--cta,var(--acc));border-color:var(--cta,var(--acc));color:var(--cta-text,#fff)}
.pp-btn.lien{border-color:transparent;background:none;color:var(--t2);padding:0 8px}
.pp-btn:active{transform:translateY(1px)}
.pp-btn:focus-visible,.pp-chip:focus-visible,#pp-tour .pp-bub:focus-visible,.pp-demo button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.pp-chip{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 11px;border-radius:999px;border:1px solid var(--bor);background:var(--sur2);color:var(--t2);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.pp-chip .d,.pp-row .d{border-radius:50%;border:2px solid var(--t3);flex:none;display:grid;place-items:center}
.pp-chip .d{width:16px;height:16px}
.pp-chip.ok{color:var(--t1);background:var(--pos-soft);border-color:transparent}
.pp-chip.ok .d,.pp-row.ok .d{background:var(--pos);border-color:var(--pos)}
.pp-chip .d svg{width:10px;height:10px;stroke:#fff;stroke-width:3;fill:none}
.pp-chip.next{border-color:var(--acc);color:var(--t1)}
@media (pointer:coarse){ .pp-chip,.pp-btn,#pp-tour .pp-demo button{min-height:44px} }
@media (min-width:1101px){ #pp-carte .pp-l1{flex-wrap:nowrap} #pp-carte .pp-act{flex:none} }
@media (min-width:768px) and (max-width:1100px){ #pp-carte .pp-act{order:2;margin-left:auto} #pp-carte .pp-chips{order:3;flex:1 1 100%} }
.accm #pp-carte{margin:6px 0 14px;padding:14px}
.accm #pp-carte .pp-l1{gap:8px}
.accm #pp-carte .pp-bar{flex:1 1 100%;width:auto;order:3}
.accm #pp-carte .pp-next{flex:1 1 100%;order:4;font-size:14px}
.accm #pp-carte .pp-act{order:5;margin-left:0;width:100%}
.accm #pp-carte .pp-act .pp-btn{flex:1 1 auto;min-height:44px}
.pp-rows{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
.pp-row{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--bor);border-radius:12px;background:var(--sur)}
.pp-row .d{width:24px;height:24px;margin-top:1px}
.pp-row .d svg{width:13px;height:13px;stroke:#fff;stroke-width:3;fill:none}
.pp-row .m{flex:1;min-width:0}
.pp-row .t,.pp-row .s,.pp-row .w{display:block}
.pp-row .t{font-weight:800;font-size:14.5px;color:var(--t1)}
.pp-row.ok .t{color:var(--t2)}
.pp-row .s{font-size:13px;color:var(--t2);margin-top:2px;line-height:1.4}
.pp-row .w{font-size:12.5px;color:var(--t3);margin-top:4px;font-weight:600}
.pp-row .go{flex:none;align-self:center}
#ov-pp .pp-revoir{width:100%;margin:0 0 12px}
.pp-row.next{border-color:var(--acc)}
#ov-pp .pp-intro{margin:0 0 12px;color:var(--t2);font-size:14px}
#ov-pp .m-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#ov-pp .m-foot .sp{flex:1}
@media (max-width:767px){ .pp-row{flex-wrap:wrap} .pp-row .go{flex:1 1 100%;padding-left:36px} .pp-row .go .pp-btn{width:100%;min-height:44px} #ov-pp .m-foot .pp-btn{min-height:44px} }
#pp-tour{position:fixed;inset:0;z-index:10050}
#pp-tour .pp-scrim{position:fixed;inset:0;background:rgba(10,13,20,.55)}
#pp-tour.trou .pp-scrim{background:transparent}
#pp-tour .pp-voile{position:fixed;inset:0;pointer-events:none}
#pp-tour .pp-bub{position:fixed;background:var(--sur);color:var(--t1);border:1px solid var(--bor);border-radius:16px;box-shadow:var(--shadow-lg);width:min(380px,calc(100vw - 24px))}
#pp-tour .pp-in{padding:16px 16px 14px;max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain}
#pp-tour .pp-arrow{position:absolute;width:14px;height:14px;background:var(--sur);border:1px solid var(--bor);transform:rotate(45deg)}
#pp-tour .pp-arrow.droite{left:-8px;border-right:0;border-top:0}
#pp-tour .pp-arrow.dessous{top:-8px;border-right:0;border-bottom:0}
#pp-tour .pp-arrow.dessus{bottom:-8px;border-left:0;border-top:0}
#pp-tour .pp-k{font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--t3)}
#pp-tour h3{font-family:'Schibsted Grotesk','Inter',sans-serif;font-weight:800;font-size:18px;line-height:1.2;margin:6px 0;color:var(--t1)}
#pp-tour p{margin:0;font-size:14.5px;line-height:1.5;color:var(--t2)}
#pp-tour .pp-ia{display:block;margin-top:8px;font-size:12px;font-weight:700;color:var(--t3)}
#pp-tour .pp-dots{display:flex;gap:5px;margin:12px 0 0}
#pp-tour .pp-dots i{width:7px;height:7px;border-radius:50%;background:var(--bor)}
#pp-tour .pp-dots i.on{background:var(--acc);width:18px;border-radius:4px}
#pp-tour .pp-f{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
#pp-tour .pp-f .sp{flex:1}
#pp-tour .pp-demo{margin-top:10px;font-size:13px;color:var(--t2)}
#pp-tour .pp-demo button{background:none;border:0;padding:0;font:inherit;font-weight:700;color:var(--t1);text-decoration:underline;cursor:pointer;min-height:40px}
@media (max-width:767px){
  #pp-tour .pp-bub{left:12px!important;right:12px;width:auto}
  #pp-tour .pp-f .pp-btn{min-height:44px;flex:1 1 auto}
  #pp-tour .pp-f .sp{display:none}
  #pp-tour .pp-demo button{min-height:44px}
}
#tp-profile .pp-prof{border:1px solid var(--bor);border-radius:var(--r);padding:16px;margin-bottom:16px}
#tp-profile .pp-prof p{margin:0 0 10px;font-size:14px;color:var(--t2)}
#tp-profile .pp-prof label{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--t1);margin-top:12px;cursor:pointer}
#tp-profile .pp-prof label input{width:18px;height:18px;margin-top:2px;flex:none}
#tp-profile .pp-prof .pp-info{font-size:13px;color:var(--t2);line-height:1.5;margin:6px 0 0 28px}`
function styles() { if (!document.getElementById('pp-css')) { const s = document.createElement('style'); s.id = 'pp-css'; s.textContent = CSS; document.head.appendChild(s) } }

// ─────────────────────────── 1. Carte de l'Accueil ───────────────────────────
const coche = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>'
// M-4 : une bannière d'action déjà à l'écran (nouveau dossier de candidature) garde le seul bouton corail.
const autrePrimaire = () => { const b = document.getElementById('cand-inbox-banner'); return !!(b && b.children.length && visible(b)) }
function carteHtml(etat) {
  const pct = Math.round(etat.faits / Math.max(1, etat.total) * 100)
  const nx = etat.suivante
  const cls = autrePrimaire() ? 'pp-btn' : 'pp-btn pri'
  const cta = nx ? `<button type="button" class="${cls}" data-pp-cta onclick="PremiersPas.faire('${nx.id}')">${esc(nx.cta)}</button>` : '<button type="button" class="pp-btn" onclick="PremiersPas.masquer()">Masquer</button>'
  const titre = `<h2 class="pp-t">${ico('flag', 16)} Premiers pas</h2>`
  if (tel()) {
    return `<div class="pp-l1">${titre}<span class="pp-n">${etat.faits} sur ${etat.total}</span><span class="pp-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      <span class="pp-next">${nx ? `Prochaine étape : <b>${esc(nx.titre)}</b>` : '<b>Mise en route terminée.</b> Tout est en place.'}</span>
      <span class="pp-act">${cta}${nx ? '<button type="button" class="pp-btn" onclick="PremiersPas.liste()">Voir les étapes</button>' : ''}</span></div>`
  }
  if (!nx) return `<div class="pp-l1">${titre}<span class="pp-next"><b>Mise en route terminée.</b> Tout est en place ; la liste disparaît d’elle-même dans ${PP.DELAI_REPLI_JOURS} jours.</span><span class="pp-act">${cta}</span></div>`
  const chips = etat.liste.map((x) => `<li><button type="button" class="pp-chip${x.fait ? ' ok' : ''}${nx.id === x.id ? ' next' : ''}" data-pp="${x.id}" aria-label="${esc(x.titre + (x.fait ? ' : fait' : ' : à faire'))}" onclick="PremiersPas.liste()"><span class="d">${x.fait ? coche : ''}</span>${esc(x.court)}</button></li>`).join('')
  return `<div class="pp-l1"><span class="pp-tb">${titre}<span class="pp-n">${etat.faits} sur ${etat.total} faites</span><span class="pp-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></span><ul class="pp-chips" aria-label="Étapes">${chips}</ul><span class="pp-act">${cta}</span></div>`
}
let _dernier = null
/** Appelée par rAccueil (PC, tablette et téléphone) après le rendu de l'Accueil. */
function carte() {
  try {
    styles()
    lireInvitationsPlusTard(); brancherInvitation()
    const ev = evaluer(); _dernier = ev
    const D = db()
    const montrer = ev && ev.pp && PP.listeVisible(D, ev.x) && PP.doitAfficherListe(ev.pp, ev.etat, maintenant())
    let c = document.getElementById('pp-carte')
    const strip = document.getElementById('pil-strip')
    if (!montrer) { if (c) c.remove(); if (strip) strip.style.display = ''; lancerSiBesoin(ev); return }
    if (!c) { c = document.createElement('section'); c.id = 'pp-carte'; c.setAttribute('aria-label', 'Premiers pas') }
    const sansLogement = !ev.etat.liste.find((x) => x.id === 'logement').fait
    c.innerHTML = carteHtml(ev.etat)
    if (tel()) {
      const a = document.querySelector('#accm-phone .accm')
      if (a) a.insertBefore(c, a.querySelector('.hero') || a.firstChild)
      if (strip) strip.style.display = ''
    } else {
      const root = document.getElementById('pil-root')
      // Indépendante de la matrice : toujours AVANT le bandeau, en tête de l'écran Pilotage.
      if (root) { if (c.parentNode !== root || c.nextElementSibling !== strip) root.insertBefore(c, strip || root.firstChild) }
      else { const p = document.getElementById('p-accueil'); if (p && c.parentNode !== p) p.insertBefore(c, p.firstChild) }
      // Compte sans logement : le bandeau de chiffres (tous à 0) cède sa place à la carte (D9, Accueil dans 900 px).
      if (strip) strip.style.display = sansLogement ? 'none' : ''
    }
    lancerSiBesoin(ev)
  } catch (e) { console.warn('[premiers-pas] carte', e && e.message) }
}
function rafraichir() { if (pageCourante() === 'accueil') carte() }

// ─────────────────────────── 2. Couche « toutes les étapes » ───────────────────────────
function liste() {
  try {
    styles()
    const ev = evaluer(); if (!ev) return
    const e = ev.etat
    const rows = e.liste.map((x, i) => {
      const prochaine = e.suivante && e.suivante.id === x.id
      return `<li class="pp-row${x.fait ? ' ok' : ''}${prochaine ? ' next' : ''}"><span class="d">${x.fait ? coche : ''}</span>
        <span class="m"><span class="t">${i + 1}. ${esc(x.titre)}</span><span class="s">${esc(x.sous)}</span>${x.fait ? '<span class="w">Fait</span>' : (x.bloque ? '<span class="w">Après le bail</span>' : '')}</span>
        ${!x.fait && !x.bloque ? `<span class="go"><button type="button" class="pp-btn${prochaine ? ' pri' : ''}" onclick="PremiersPas.faire('${x.id}')">${esc(x.cta)}</button></span>` : ''}</li>`
    }).join('')
    // Ouverte aussi depuis l'entrée « Premiers pas » (barre latérale, Plus) : la carte peut être masquée ou repliée.
    // ici : la carte peut exister sur l'accueil de ce compte (D11 : pas pour un associé sans structure propre).
    const ici = !!(ev.pp && PP.listeVisible(db(), ev.x))
    const montre = ici && PP.doitAfficherListe(ev.pp, e, maintenant())
    const old = document.getElementById('ov-pp'); if (old) old.remove()
    document.body.insertAdjacentHTML('beforeend', `<div class="ov" id="ov-pp"><div class="modal" style="max-width:620px" role="dialog" aria-modal="true" aria-labelledby="pp-liste-t">
      <div class="m-head"><h3 id="pp-liste-t">Premiers pas · ${e.faits} sur ${e.total}</h3><button type="button" class="m-close" aria-label="Fermer" onclick="PremiersPas.fermerListe()">${ico('close', 18)}</button></div>
      <div class="m-body"><button type="button" class="pp-btn pp-revoir" onclick="PremiersPas.fermerListe();PremiersPas.relancer()">${ico('play', 14)} Revoir la visite guidée</button><p class="pp-intro">Chaque étape se coche seule quand l’action est faite dans l’app.</p><ul class="pp-rows">${rows}</ul></div>
      <div class="m-foot">${montre ? `<button type="button" class="pp-btn lien" onclick="PremiersPas.fermerListe();PremiersPas.masquer()">${ico('eye', 14)} Masquer de l’accueil</button>` : (ici ? `<button type="button" class="pp-btn lien" onclick="PremiersPas.fermerListe();PremiersPas.afficher()">${ico('eye', 14)} Afficher sur l’accueil</button>` : '')}<span class="sp"></span><button type="button" class="pp-btn" onclick="PremiersPas.fermerListe()">Fermer</button></div></div></div>`)
    if (G('openM')) W.openM('ov-pp')
    const ov = document.getElementById('ov-pp')
    ov.addEventListener('keydown', (k) => { if (k.key === 'Escape') { k.stopPropagation(); fermerListe() } })
    const b = ov.querySelector('.pp-row.next .pp-btn, .m-close'); if (b) b.focus()
  } catch (e) { console.warn('[premiers-pas] liste', e && e.message) }
}
function fermerListe() { const o = document.getElementById('ov-pp'); if (o) o.remove() }

// ─────────────────────────── Actions de chaque étape ───────────────────────────
function premierLogement(filtre) {
  const D = db() || {}
  return (D.logements || []).find((l) => vivant(l) && !l.archived && filtre(l)) || null
}
function ouvrirParametres(onglet) {
  if (G('go')) W.go('params')
  const t = document.querySelector('#p-params .tab[onclick*="\'' + onglet + '\'"]')
  if (t && G('setParamsTab')) W.setParamsTab(onglet, t)
}
function faire(id) {
  if (!ID_ETAPE.test(String(id))) return
  fermerListe(); fin(null)
  try {
    if (id === 'logement') { if (G('openBiensAdd')) W.openBiensAdd(); return }
    if (id === 'bail') {
      const l = premierLogement((x) => !(G('_bienActiveBail') && W._bienActiveBail(x.ref)))
      if (l && G('openBail')) W.openBail(l.ref); else if (G('openBiensAdd')) W.openBiensAdd()
      return
    }
    // Même geste que le bouton « Importer » de l'onglet Mouvements.
    if (id === 'releve') { if (G('go')) W.go('mouvements'); if (G('_bankImportOpen')) W._bankImportOpen(); return }
    if (id === 'regle') { if (G('_bankRulesOpen')) W._bankRulesOpen(); else ouvrirParametres('rules'); return }
    if (id === 'espace') {
      const l = premierLogement((x) => !!(G('_bienActiveBail') && W._bienActiveBail(x.ref)))
      if (l && G('openLogFiche')) { W.openLogFiche(l.ref); if (G('setLogFicheTab')) W.setLogFicheTab('bail'); setTimeout(() => { const b = document.getElementById('el-bloc'); if (b) b.scrollIntoView({ block: 'center' }) }, 400) }
      return
    }
    if (id === 'plafond' || id === 'artisan') { ouvrirParametres('artisans'); return }
    if (id === 'associe') { ouvrirParametres('partage'); if (G('_partageOpenInvite')) setTimeout(() => W._partageOpenInvite(), 300); return }
  } catch (e) { console.warn('[premiers-pas] action', id, e && e.message) }
}
function masquer() {
  const pp = lirePP(); if (!pp) return
  enregistrer(PP.masquer(pp, maintenant()))
  toast('Liste masquée de l’accueil. Elle reste dans le menu, à « Premiers pas ».', 'info', 4500)
  rafraichir()
}
function afficher() {
  const pp = lirePP(); if (!pp) return
  enregistrer(PP.afficher(pp, maintenant()))
  toast('Liste « Premiers pas » affichée sur l’accueil.', 'ok', 3000)
  if (pageCourante() === 'params' && G('rParamsProfile')) W.rParamsProfile()
  rafraichir()
}
function reglerMesure(oui) {
  const ev = evaluer()   // d'abord : une progression mise à jour ici ne doit pas être écrasée
  const pp = lirePP(); if (!pp) return
  if (!!oui === (pp.mesure !== false)) return
  enregistrer(PP.reglerMesure(pp, !!oui, ev && ev.etat, maintenant()))
  toast(oui ? 'Progression de mise en route partagée avec Propryo.' : 'Progression de mise en route non partagée : les dates enregistrées sont effacées.', 'ok', 4500)
}

// ─────────────────────────── 3. Visite guidée ───────────────────────────
const bnav = (page) => document.querySelector('#v4-bnav .v4-bn[data-page="' + page + '"]')
const plus = () => bnav('more')
const side = (id) => document.querySelector('.v4s-a[data-nav="' + id + '"]')
const chip = (id) => document.querySelector('#pp-carte [data-pp="' + id + '"]')
const carteEl = () => document.getElementById('pp-carte')
// Zone(s) pointée(s) par étape ; la première visible gagne, sinon la bulle se centre (jamais d'échec).
const CIBLES = {
  intro: () => [],
  presse: () => (tel() ? [[document.querySelector('#accm-phone .watch')]] : [[document.getElementById('pil-bulles')]]),
  biens: () => (tel() ? [[bnav('biens')], [plus()]] : [[side('biens')]]),
  espace: () => (tel() ? [[carteEl()]] : [[chip('espace')], [carteEl()]]),
  incident: () => (tel() ? [[carteEl()]] : [[chip('plafond'), chip('artisan')], [carteEl()]]),
  edl: () => (tel() ? [[bnav('fav:addedl')], [plus()]] : [[side('edl')]]),
  candidats: () => (tel() ? [[plus()]] : [[side('baux')]]),
}
function zones(k) {
  for (const grp of (CIBLES[k] || (() => []))()) { const v = grp.filter(visible); if (v.length) return v }
  return []
}
let _cur = -1, _focusAvant = null, _lance = false
function lancerSiBesoin(ev) {
  if (_lance || _cur >= 0 || !ev || !ev.pp || !PP.doitLancerVisite(ev.pp)) return
  if (pageCourante() !== 'accueil' || W.__immoDemo) return
  const login = document.getElementById('imsb-overlay'); if (login && visible(login)) return
  if (document.querySelector('.ov:not(.hidden)')) return
  _lance = true
  // Revérifié au moment de lancer : une couche ouverte entre-temps (fil rouge, popup) ou l'écran de connexion passe avant.
  setTimeout(() => { try { const lg = document.getElementById('imsb-overlay'); if (_cur < 0 && pageCourante() === 'accueil' && !document.querySelector('.ov:not(.hidden)') && !(lg && visible(lg)) && PP.doitLancerVisite(lirePP())) visite(PP.etapeDeReprise(lirePP())); else if (_cur < 0) _lance = false } catch (e) { _lance = false } }, 600)
}
function relancer() {
  const pp = lirePP()
  _lance = true   // la relance lance elle-même la visite : pas de second départ par la carte
  if (pp) enregistrer(PP.visiteRelancer(pp, maintenant()))
  if (pageCourante() !== 'accueil' && G('go')) W.go('accueil')
  setTimeout(() => visite(1), 350)
}
function visite(i) {
  styles()
  const n = PP.VISITE.length - 1
  i = Math.max(0, Math.min(n, i | 0))
  if (_cur < 0) _focusAvant = document.activeElement
  _cur = i
  const pp = lirePP(); if (pp) enregistrer(PP.visiteEtape(pp, i, maintenant()))   // chaque étape : la visite reprend là où elle s'est arrêtée
  const st = PP.VISITE[i]
  const zs = zones(st.k)
  if (zs[0]) zs[0].scrollIntoView({ block: 'center' })
  let host = document.getElementById('pp-tour')
  if (!host) { host = document.createElement('div'); host.id = 'pp-tour'; document.body.appendChild(host) }
  const txt = (tel() && st.txtTel) ? st.txtTel : st.txt
  const intro = i === 0
  const dots = Array.from({ length: n }, (_, j) => `<i class="${j + 1 === i ? 'on' : ''}"></i>`).join('')
  const demo = intro && !W.__immoDemo
  host.className = zs.length ? 'trou' : ''
  host.innerHTML = `<div class="pp-scrim"></div><div class="pp-bub" role="dialog" aria-modal="true" aria-labelledby="pp-h" aria-describedby="pp-p" tabindex="-1">
      ${zs.length ? '<span class="pp-arrow"></span>' : ''}<div class="pp-in">
      <div class="pp-k">${intro ? 'Visite guidée' : 'Visite · ' + i + ' sur ' + n}</div>
      <h3 id="pp-h">${esc(st.titre)}</h3><p id="pp-p">${esc(txt)}</p>${st.ia ? `<span class="pp-ia">${esc(PP.MENTION_IA)}</span>` : ''}
      ${intro ? '' : `<div class="pp-dots" aria-hidden="true">${dots}</div>`}
      <div class="pp-f">${intro
        ? '<button type="button" class="pp-btn pri" data-pp-go="1">Commencer la visite</button><button type="button" class="pp-btn" data-pp-fin="passee">Passer</button>'
        : `<button type="button" class="pp-btn lien" data-pp-fin="passee">Passer</button><span class="sp"></span>${i > 1 ? `<button type="button" class="pp-btn" data-pp-go="${i - 1}">Précédent</button>` : ''}<button type="button" class="pp-btn pri" ${i < n ? `data-pp-go="${i + 1}"` : 'data-pp-fin="finie"'}>${i < n ? 'Suivant' : 'Terminer'}</button>`}</div>
      ${demo ? '<div class="pp-demo">Voir d’abord un parc rempli : <button type="button" data-pp-demo>ouvrir la démonstration</button> (nouvel onglet, données fictives).</div>' : ''}
      ${intro ? '<div class="pp-demo">La visite se relance depuis « Premiers pas », dans le menu.</div>' : ''}
    </div></div>`
  host.onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return
    if (b.hasAttribute('data-pp-go')) visite(+b.getAttribute('data-pp-go'))
    else if (b.hasAttribute('data-pp-fin')) fin(b.getAttribute('data-pp-fin'))
    else if (b.hasAttribute('data-pp-demo')) { try { W.open(location.pathname + '?demo=1', '_blank', 'noopener') } catch (e) { /* bloqué */ } }
  }
  placer()
  const pri = host.querySelector('.pp-btn.pri'); (pri || host.querySelector('.pp-bub')).focus()
}
function placer() {
  const host = document.getElementById('pp-tour'); if (!host || _cur < 0) return
  const bub = host.querySelector('.pp-bub'); const zs = zones(PP.VISITE[_cur].k)
  const old = host.querySelector('.pp-voile'); if (old) old.remove()
  if (!zs.length) {
    const r = bub.getBoundingClientRect()
    Object.assign(bub.style, { left: Math.max(12, (innerWidth - r.width) / 2) + 'px', top: Math.max(12, (innerHeight - r.height) / 2) + 'px' })
    return
  }
  const pad = 6, rr = 12, vw = innerWidth, vh = innerHeight
  const rs = zs.map((z) => z.getBoundingClientRect())
  const trou = (z) => { const x = z.left - pad, y = z.top - pad, w = z.width + pad * 2, h = z.height + pad * 2; return `M${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h - rr}A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}H${x + rr}A${rr},${rr} 0 0 1 ${x},${y + h - rr}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}Z` }
  host.insertAdjacentHTML('afterbegin', `<svg class="pp-voile" width="${vw}" height="${vh}" aria-hidden="true"><path fill="rgba(10,13,20,.55)" fill-rule="evenodd" d="M0,0H${vw}V${vh}H0Z ${rs.map(trou).join(' ')}"/>${rs.map((z) => `<rect x="${z.left - pad}" y="${z.top - pad}" width="${z.width + pad * 2}" height="${z.height + pad * 2}" rx="${rr}" fill="none" stroke="var(--acc)" stroke-width="3"/>`).join('')}</svg>`)
  const u = rs.reduce((a, z) => ({ left: Math.min(a.left, z.left), top: Math.min(a.top, z.top), right: Math.max(a.right, z.right), bottom: Math.max(a.bottom, z.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
  const nav = document.getElementById('v4-bnav'); const nr = nav && visible(nav) ? nav.getBoundingClientRect() : null
  const b = bub.getBoundingClientRect()
  const p = PP.placerBulle({ cible: { left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top }, bulle: { width: b.width, height: b.height }, vue: { l: vw, h: vh }, barreBas: nr ? { top: nr.top, height: nr.height } : null, tel: tel() })
  Object.assign(bub.style, { left: p.left + 'px', top: p.top + 'px' })
  const ar = bub.querySelector('.pp-arrow')
  if (ar) { ar.className = 'pp-arrow ' + p.cote; if (p.cote === 'droite') { ar.style.top = p.flecheDecalage + 'px'; ar.style.left = '' } else { ar.style.left = p.flecheDecalage + 'px'; ar.style.top = '' } }
}
function fin(mode) {
  const host = document.getElementById('pp-tour')
  if (host) host.remove()
  const etait = _cur >= 0; _cur = -1
  if (!mode || !etait) return
  const pp = lirePP(); if (pp) enregistrer(PP.visiteFin(pp, mode, maintenant()))
  // « Terminer » rend la main à la carte ; « Passer » à l'élément d'avant.
  const cible = mode === 'finie' ? document.querySelector('#pp-carte [data-pp-cta]') : _focusAvant
  try { if (cible && cible.focus) cible.focus() } catch (e) { /* ignoré */ }
}
// Clavier : Échap = Passer, ← / → = précédent / suivant, Tab reste dans la bulle.
function clavier(ev) {
  if (_cur < 0) return
  const host = document.getElementById('pp-tour'); if (!host) return
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fin('passee'); return }
  if (ev.key === 'ArrowRight' && _cur > 0 && _cur < PP.VISITE.length - 1) { ev.preventDefault(); visite(_cur + 1); return }
  if (ev.key === 'ArrowLeft' && _cur > 1) { ev.preventDefault(); visite(_cur - 1); return }
  if (ev.key === 'Tab') {
    const f = [...host.querySelectorAll('button')]; if (!f.length) return
    const i = f.indexOf(document.activeElement)
    if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus() }
    else if (!ev.shiftKey && (i === f.length - 1 || i < 0)) { ev.preventDefault(); f[0].focus() }
  }
}

// ─────────────────────────── 4. Paramètres › Mon profil ───────────────────────────
/** Appelée à la fin de rParamsProfile : relance de la visite, réaffichage de la liste, mesure (D6). */
function profil(wrap) {
  try {
    if (!wrap) return
    styles()
    const btn = wrap.querySelector('[onclick*="_profileWizardOpen"]')
    if (btn && !wrap.querySelector('[data-pp-relance]')) {
      btn.insertAdjacentHTML('afterend', `<button type="button" class="btn bs bb" data-pp-relance onclick="PremiersPas.relancer()">${ico('play', 14)} Relancer la visite guidée</button>`)
      if (btn.parentElement) btn.parentElement.style.flexWrap = 'wrap'
    }
    const ev = evaluer(); const pp = ev && ev.pp
    if (!pp || wrap.querySelector('.pp-prof')) return
    const ici = PP.listeVisible(db(), ev.x)
    const montre = ici && PP.doitAfficherListe(pp, ev.etat, maintenant())
    const etatTxt = `${ev.etat.faits} étape${ev.etat.faits > 1 ? 's' : ''} sur ${ev.etat.total} faite${ev.etat.faits > 1 ? 's' : ''}.`
    const hote = wrap.firstElementChild || wrap
    hote.insertAdjacentHTML('beforeend', `<div class="ct mb12" style="font-size:14px">${ico('flag', 15)} Premiers pas</div>
      <div class="pp-prof"><p>${montre ? 'Liste affichée sur l’accueil.' : (ici ? 'Liste masquée sur l’accueil.' : 'Aucune structure propre à ce compte : la liste ne s’affiche pas sur l’accueil.')} ${esc(etatTxt)}</p>
        ${montre || !ici ? '' : `<button type="button" class="btn bs bb" onclick="PremiersPas.afficher()">${ico('eye', 14)} Afficher la liste sur l’accueil</button>`}
        <label><input type="checkbox"${pp.mesure !== false ? ' checked' : ''} onchange="PremiersPas.mesure(this.checked)"> <span>Partager la progression de mise en route avec Propryo</span></label>
        <div class="pp-info">Propryo enregistre dans le compte les étapes de mise en route faites et leur date, pour mesurer la prise en main pendant la bêta. Aucun outil de mesure extérieur, aucune donnée de locataire. Décocher efface les dates des étapes et n’en enregistre plus ; seul reste ce qui sert à l’affichage (liste masquée, visite passée, fin de la mise en route).</div>
      </div>`)
  } catch (e) { console.warn('[premiers-pas] profil', e && e.message) }
}

// ─────────────────────────── Démarrage ───────────────────────────
let _demarre = false
export function demarrer() {
  if (_demarre) return
  _demarre = true
  W.PremiersPas = { carte, liste, fermerListe, faire, masquer, afficher, relancer, visite, fin, profil, mesure: reglerMesure }
  document.addEventListener('keydown', clavier, true)
  W.addEventListener('resize', () => { if (_cur >= 0) placer() })
  // Un défilement sous le voile (téléphone) décalerait les zones percées : on les replace.
  document.addEventListener('scroll', () => { if (_cur >= 0) placer() }, true)
  // L'Accueil a pu être rendu avant le chargement de ce module, ou avant que les données du compte soient chargées
  // (cloud : hydratation) : on réessaie quelques secondes, puis plus rien (aucune minuterie permanente).
  if (pageCourante() === 'accueil') carte()
  let essais = 0
  const t = setInterval(() => { essais++; if (lirePP() || essais > 30) { clearInterval(t); if (lirePP() && pageCourante() === 'accueil' && !document.getElementById('pp-carte')) carte(); return } if (donneesPretes() && pageCourante() === 'accueil') carte() }, 1000)
}

export const _pourTests = { evaluer, extActuel, ext, carteHtml, CIBLES }
