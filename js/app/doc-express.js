// Documents « express » venus de propryo.fr (quittance, bail, état des lieux, avenant).
//
// Parcours : l'utilisateur remplit un formulaire sur le site ; le bouton ouvre l'app dans un nouvel onglet
// (…/?inscription&doc=attente) et lui envoie les champs par postMessage. Rien ne passe par l'URL, donc rien dans
// l'historique du navigateur. Le script inline d'index.html (avant le routeur) n'accepte le message que si
// event.origin est propryo.fr ou www.propryo.fr ET que l'expéditeur est l'onglet qui a ouvert l'app ; il range la
// saisie dans localStorage (30 min). L'inscription ou la connexion se déroule ensuite normalement ; une fois l'app
// affichée, ce module génère le PDF (jsPDF déjà embarqué) et le propose en téléchargement.
//
// Rien n'est jamais écrit dans les données de l'utilisateur : c'est un simple téléchargement.

export const CLE_DOC_EXPRESS = 'imsb-doc-express'
const VALIDITE_MS = 30 * 60 * 1000
const TYPES = ['quittance', 'edl', 'avenant']   // pas de bail express : le bail conforme (décret 2026-596) se fait dans l'app
export const MAX_CHAMP = 300
export const MAX_TAILLE = 20000

export const MESSAGE_SUIVI =
  'Le document est téléchargé. Pour le suivi et la sauvegarde, Propryo est là : biens, locataires, loyers et documents réunis au même endroit.'

// ── validation (pure, testable) : refus explicite, jamais de troncature silencieuse ──
export function validerDocExpress(brut) {
  try {
    if (!brut || typeof brut !== 'object' || Array.isArray(brut) || !TYPES.includes(brut.type)) return { erreur: 'format' }
    if (JSON.stringify(brut).length > MAX_TAILLE) return { erreur: 'taille' }
    const champs = nettoyerChamps(brut.champs)
    if (champs === null) return { erreur: 'taille' }
    return { doc: { type: brut.type, champs } }
  } catch (e) { return { erreur: 'format' } }
}

// null = champ ou liste trop long (refus) ; clés au format inattendu ignorées
function nettoyerChamps(c) {
  const out = {}
  if (!c || typeof c !== 'object' || Array.isArray(c)) return out
  const entrees = Object.entries(c)
  if (entrees.length > 40) return null
  for (const [k, v] of entrees) {
    if (!/^[a-zA-Z]{1,24}$/.test(k)) continue
    if (typeof v === 'string') { if (v.length > MAX_CHAMP) return null; out[k] = v }
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) {
      if (v.length > 30) return null
      const l = v.map(x => (x && typeof x === 'object' ? nettoyerChamps(x) : String(x)))
      if (l.some(x => x === null || (typeof x === 'string' && x.length > MAX_CHAMP))) return null
      out[k] = l
    } else if (v && typeof v === 'object') { const o = nettoyerChamps(v); if (o === null) return null; out[k] = o }
  }
  return out
}

/** Purge : expirée ou ancien format (#doc= base64) = supprimée. Appelée à CHAQUE chargement par index.html ; ici pour les tests. */
export function purgerPerimes(storage = (typeof localStorage !== 'undefined' ? localStorage : null), maintenant = Date.now()) {
  try {
    if (!storage) return
    const brut = storage.getItem(CLE_DOC_EXPRESS)
    if (!brut) return
    const r = JSON.parse(brut)
    if (!r || !r.doc || !r.t || !(maintenant - r.t < VALIDITE_MS)) storage.removeItem(CLE_DOC_EXPRESS)
  } catch (e) { try { storage && storage.removeItem(CLE_DOC_EXPRESS) } catch (_) {} }
}

/** Rend { doc } (valide), { erreur } (reçu mais refusé) ou null (rien en attente). */
export function lireEnAttente(storage = (typeof localStorage !== 'undefined' ? localStorage : null), maintenant = Date.now()) {
  try {
    if (!storage) return null
    purgerPerimes(storage, maintenant)
    const brut = storage.getItem(CLE_DOC_EXPRESS)
    if (!brut) return null
    const v = validerDocExpress((JSON.parse(brut) || {}).doc)
    if (v.erreur) { storage.removeItem(CLE_DOC_EXPRESS); return { erreur: v.erreur } }
    return v
  } catch (e) { try { storage && storage.removeItem(CLE_DOC_EXPRESS) } catch (_) {} return null }
}

// ── mise en forme ───────────────────────────────────────────────────────────
const eur = n => (isNaN(n) ? 0 : n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= 10000000 ? n : 0 }
const txt = (v, defaut = '…') => (v == null || String(v).trim() === '' ? defaut : String(v).trim())
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const PIED = 'Document établi avec Propryo (propryo.fr). Il ne remplace pas un conseil juridique.'

// Bandeau d'identité commun à TOUS les documents de l'app (gabarit DOCUMENTS-PROPRYO, variante B) : logo Propryo vectoriel à
// droite, filet fin dessous, gauche vide (aucun logo de bailleur connu ici). Même fonction que la quittance, le bail et l'EDL
// de l'app (window._pdfDrawBrandzone). Retourne l'ordonnée où le contenu peut reprendre ; sans la fonction (contexte hors
// app), le document sort sans bandeau plutôt qu'en erreur.
export function bandeauPropryo(pdf, y, largeur, marge) {
  try {
    if (typeof window !== 'undefined' && typeof window._pdfDrawBrandzone === 'function') {
      const apres = window._pdfDrawBrandzone(pdf, {}, marge, y, largeur - marge)
      if (typeof apres === 'number' && apres > y) return apres
    }
  } catch (e) { try { console.warn('[doc-express] bandeau', e) } catch (_) {} }
  return y
}

// Petit « stylo » au-dessus de jsPDF : sauts de page automatiques, titres, paragraphes.
function stylo(J, { marge = 20, titrePage = '' } = {}) {
  const d = new J({ unit: 'mm', format: 'a4' })
  const W = 210, H = 282
  const s = { d, W, M: marge, y: 26 }
  s.y = bandeauPropryo(d, 14, W, marge) + 4
  s.saut = h => { if (s.y + h > H) { d.addPage(); s.y = 24 } }
  s.titreDoc = (t, sous) => {
    d.setFont('helvetica', 'bold'); d.setFontSize(20); d.setTextColor(0); d.text(t, s.M, s.y); s.y += 8
    if (sous) { d.setFont('helvetica', 'normal'); d.setFontSize(12); d.setTextColor(90); d.text(sous, s.M, s.y); d.setTextColor(0); s.y += 6 }
  }
  s.titre = t => { s.saut(14); s.y += 4; d.setFont('helvetica', 'bold'); d.setFontSize(12); d.setTextColor(0); d.text(t, s.M, s.y); s.y += 7 }
  s.para = (t, taille = 10.5) => {
    d.setFont('helvetica', 'normal'); d.setFontSize(taille); d.setTextColor(0)
    const li = d.splitTextToSize(t, W - 2 * s.M)
    s.saut(5.2 * li.length + 2); d.text(li, s.M, s.y); s.y += 5.2 * li.length + 2.5
  }
  s.ligne = (a, b) => {
    s.saut(7); d.setFont('helvetica', 'bold'); d.setFontSize(10.5); d.text(a, s.M, s.y)
    d.setFont('helvetica', 'normal'); const li = d.splitTextToSize(b, W - 2 * s.M - 42); d.text(li, s.M + 42, s.y); s.y += 6 * li.length + 1
  }
  s.pieds = () => {
    const n = d.getNumberOfPages()
    for (let i = 1; i <= n; i++) { d.setPage(i); d.setFontSize(8); d.setTextColor(130); d.text(PIED + ' Page ' + i + '/' + n, s.M, 291) }
  }
  s.signatures = (g, dr, lieu, date) => {
    s.saut(48); s.y += 6
    s.para('Fait à ' + txt(lieu, '____________________') + ', le ' + txt(date, '____ / ____ / ________') + '.')
    s.y += 8; d.setFont('helvetica', 'normal'); d.setFontSize(10.5); d.text(g, s.M, s.y); d.text(dr, W - s.M - 40, s.y)
  }
  return s
}

// ── générateurs (un par type) ───────────────────────────────────────────────
export function pdfQuittance(J, c) {
  const l = num(c.loyer), ch = num(c.charges), periode = txt(c.mois, '') + ' ' + txt(c.annee, '')
  const d = new J({ unit: 'mm', format: 'a4' }), W = 210, M = 22
  let y = bandeauPropryo(d, 14, W, M) + 8
  d.setFont('helvetica', 'bold'); d.setFontSize(22); d.text('QUITTANCE DE LOYER', M, y); y += 9
  d.setFont('helvetica', 'normal'); d.setFontSize(12); d.setTextColor(90); d.text('Période : ' + periode.trim(), M, y); y += 14
  d.setTextColor(0); d.setFontSize(11)
  d.setFont('helvetica', 'bold'); d.text('Bailleur', M, y); d.setFont('helvetica', 'normal'); d.text(d.splitTextToSize(txt(c.bailleur, ''), W - 2 * M - 34), M + 34, y); y += 7
  d.setFont('helvetica', 'bold'); d.text('Locataire', M, y); d.setFont('helvetica', 'normal'); d.text(d.splitTextToSize(txt(c.locataire, ''), W - 2 * M - 34), M + 34, y); y += 7
  d.setFont('helvetica', 'bold'); d.text('Logement', M, y); d.setFont('helvetica', 'normal')
  const adr = d.splitTextToSize(txt(c.adresse, ''), W - 2 * M - 34); d.text(adr, M + 34, y); y += 7 * adr.length + 8
  d.setDrawColor(200); d.line(M, y, W - M, y); y += 9
  d.text('Loyer', M, y); d.text(eur(l) + ' EUR', W - M, y, { align: 'right' }); y += 8
  d.text('Provision pour charges', M, y); d.text(eur(ch) + ' EUR', W - M, y, { align: 'right' }); y += 5
  d.line(M, y, W - M, y); y += 8
  d.setFont('helvetica', 'bold'); d.setFontSize(13); d.text('Total acquitté', M, y); d.text(eur(l + ch) + ' EUR', W - M, y, { align: 'right' }); y += 14
  d.setFont('helvetica', 'normal'); d.setFontSize(11)
  const corps = 'Je soussigné(e) ' + txt(c.bailleur) + ', bailleur, déclare avoir reçu de ' + txt(c.locataire) + ' la somme de ' + eur(l + ch) +
    ' euros au titre du loyer et des charges de la période indiquée, et lui en donne quittance, sous réserve de tous mes droits.'
  const li = d.splitTextToSize(corps, W - 2 * M); d.text(li, M, y); y += 6 * li.length + 12
  d.text('Fait à ' + txt(c.lieu) + ', le ' + txt(c.date), M, y); y += 18
  d.text('Le bailleur', W - M - 40, y)
  d.setFontSize(8); d.setTextColor(130)
  d.text(d.splitTextToSize('Quittance établie en application de l’article 21 de la loi du 6 juillet 1989. ' + PIED, W - 2 * M), M, 281)
  return { pdf: d, nom: 'quittance-' + slug(periode) + '.pdf' }
}

const ETATS = { neuf: 'Neuf', bon: 'Bon état', usage: "État d'usage", mauvais: 'Mauvais état' }

export const REF_EDL = "décret n° 2016-382 du 30 mars 2016 fixant les modalités d'établissement de l'état des lieux et de prise en compte de la vétusté des logements loués à usage de résidence principale"

export function pdfEdl(J, c) {
  const sortie = c.sens === 'sortie'
  const s = stylo(J)
  s.titreDoc("ÉTAT DES LIEUX " + (sortie ? 'DE SORTIE' : "D'ENTRÉE"), 'Établi contradictoirement entre le bailleur et le locataire')
  s.para("Modèle de base établi d'après les informations minimales de l'article 2 du " + REF_EDL + ". Vérifier que toutes ces informations sont renseignées avant signature.", 9.5)
  s.titre('Les parties et le logement')
  s.ligne('Type', sortie ? 'État des lieux de sortie' : "État des lieux d'entrée")
  s.ligne('Date', txt(c.date, '____ / ____ / ________'))
  s.ligne('Logement', txt(c.adresse, '____________________'))
  s.ligne('Bailleur', txt(c.bailleur, '____________________'))
  s.ligne('Domicile du bailleur', txt(c.bailleurAdresse, '____________________'))
  s.ligne('Locataire', txt(c.locataire, '____________________'))
  s.ligne('Mandataire', txt(c.mandataire, 'sans objet'))
  s.titre('Relevés des compteurs individuels')
  const co = c.compteurs || {}
  s.ligne('Électricité', txt(co.elec, '________')); s.ligne('Eau', txt(co.eau, '________')); s.ligne('Gaz', txt(co.gaz, '________'))
  s.titre('Clés et moyens d\u2019accès')
  s.para(txt(c.cles, '____') + ' clé(s), badge(s) ou télécommande(s). Détail et destination : ' + txt(c.detailCles, '________________________________') + '.')
  s.titre('Pièces et éléments du logement')
  const pieces = Array.isArray(c.pieces) && c.pieces.length ? c.pieces : [{ nom: 'Pièce', etat: 'bon', remarque: '' }]
  pieces.forEach(p => {
    const rem = txt(p.remarque, '')
    s.para('[ ] ' + txt(p.nom, 'Pièce') + ' (sols, murs, plafonds, équipements) : ' + (Object.prototype.hasOwnProperty.call(ETATS, p.etat) ? ETATS[p.etat] : '') + (rem ? '. ' + rem : '.'))
  })
  s.para('Description précise de chaque pièce à compléter. Photos horodatées recommandées pour chaque pièce et chaque défaut constaté.', 9.5)
  if (sortie) {
    s.titre('À la sortie du logement')
    s.ligne('Nouveau domicile', txt(c.nouveauDomicile, '____________________'))
    s.ligne('État des lieux d\u2019entrée', 'établi le ' + txt(c.dateEntree, '____ / ____ / ________'))
    s.para("Évolutions de l'état de chaque pièce constatées depuis l'état des lieux d'entrée : " + txt(c.evolutions, '________________________________') + '.')
  }
  s.titre('Observations ou réserves')
  s.para(txt(c.observations, '________________________________________________________________'))
  s.para("L'état des lieux est établi sur support papier ou électronique, remis en main propre ou par voie dématérialisée à chacune des parties au moment de la signature, sous une forme qui permet de comparer l'état du logement à l'entrée et à la sortie.")
  s.signatures('Le bailleur', 'Le locataire', c.lieu, c.date)
  s.pieds()
  return { pdf: s.d, nom: 'etat-des-lieux-' + (sortie ? 'sortie' : 'entree') + '.pdf' }
}

// Texte de loi : recopié mot pour mot depuis Légifrance (article 17-1 de la loi n° 89-462 du 6 juillet 1989,
// « Version en vigueur depuis le 24 août 2022 »), page lue le 7 octobre 2026. Ne jamais reformuler.
export const REF_LOI_17_1 = 'Loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs, article 17-1 (version en vigueur depuis le 24 août 2022, texte lu sur Légifrance le 7 octobre 2026)'
export const TEXTE_17_1_II = "II. ― Lorsque les parties sont convenues, par une clause expresse, de travaux d'amélioration du logement que le bailleur fera exécuter, le contrat de location ou un avenant à ce contrat peut fixer la majoration du loyer consécutive à la réalisation de ces travaux. Cette majoration ne peut faire l'objet d'une action en diminution de loyer."
export const TEXTE_17_1_III = "III. ― La révision et la majoration de loyer prévues aux I et II du présent article ne peuvent pas être appliquées dans les logements de la classe F ou de la classe G, au sens de l'article L. 173-1-1 du code de la construction et de l'habitation."
export const APPLICATION_17_1 = "Conformément au IV de l'article 159 de la loi n° 2021-1104 du 22 août 2021, ces dispositions sont applicables aux contrats de location conclus, renouvelés ou tacitement reconduits un an après la publication de la présente loi. En Guadeloupe, en Martinique, en Guyane, à La Réunion et à Mayotte, ces dispositions sont applicables aux contrats de location conclus, renouvelés ou tacitement reconduits après le 1er juillet 2024."

export function pdfAvenant(J, c) {
  const classe = String(c.classeDpe || '').toUpperCase()
  if (classe === 'F' || classe === 'G') throw new Error('dpe-fg')   // majoration interdite : aucun document produit
  const actuel = num(c.loyerActuel), nouveau = num(c.loyerNouveau), travaux = num(c.montantTravaux)
  const hausse = Math.max(0, nouveau - actuel)
  const s = stylo(J)
  s.titreDoc('AVENANT AU BAIL', 'Majoration du loyer consécutive à des travaux d\u2019amélioration')
  s.titre('Entre les soussignés')
  s.para('Le bailleur : ' + txt(c.bailleur) + '.'); s.para('Le locataire : ' + txt(c.locataire) + '.')
  s.titre('Le bail concerné')
  s.para('Bail du ' + txt(c.dateBail, '____ / ____ / ________') + ' portant sur le logement situé : ' + txt(c.adresse) + '.')
  s.para('Classe énergétique du logement (DPE) : ' + (classe && classe !== 'INCONNUE' ? classe : '____ (à renseigner : la majoration est impossible en classe F ou G)') + '.')
  s.titre('Article 1. Travaux d\u2019amélioration convenus')
  s.para("Les parties sont convenues, par une clause expresse du bail ou du présent avenant, des travaux d'amélioration du logement suivants, que le bailleur fera exécuter : " + txt(c.objet, '________________________________________________') + '.')
  if (travaux > 0) s.para('Montant prévisionnel des travaux (TTC) : ' + eur(travaux) + ' euros.')
  s.titre('Article 2. Majoration du loyer')
  s.para('Loyer mensuel hors charges avant travaux : ' + eur(actuel) + ' euros. Nouveau loyer mensuel hors charges : ' + eur(nouveau) + ' euros, soit une majoration de ' + eur(hausse) + ' euros par mois (' + eur(hausse * 12) + ' euros par an).')
  s.para("Le nouveau loyer s'applique à compter du " + txt(c.dateEffet, '____ / ____ / ________') + ' (réalisation des travaux). Les autres clauses du bail demeurent inchangées.')
  s.titre('Article 3. Accord des parties')
  s.para("Le locataire déclare accepter la majoration ci-dessus. L'avenant est signé en deux exemplaires et annexé au bail.")
  s.titre('Textes applicables (citation)')
  s.para(REF_LOI_17_1 + ' :', 9.5)
  s.para(TEXTE_17_1_II, 9.5)
  s.para(TEXTE_17_1_III, 9.5)
  s.para(APPLICATION_17_1, 9.5)
  s.para("Cette citation ne remplace pas la lecture du texte en vigueur sur Légifrance. Avant signature, vérifier la classe énergétique, la clause expresse de travaux et, le cas échéant, les règles d'encadrement du loyer applicables.", 9.5)
  s.signatures('Le bailleur', 'Le locataire', c.lieu, c.date)
  s.pieds()
  return { pdf: s.d, nom: 'avenant-bail-travaux.pdf' }
}

const GENERATEURS = { quittance: pdfQuittance, edl: pdfEdl, avenant: pdfAvenant }
export function genererDocument(J, doc) {
  const g = GENERATEURS[doc && doc.type]
  if (!g) throw new Error('type de document inconnu')
  return g(J, doc.champs || {})
}

// ── chargement de jsPDF (déjà embarqué en base64 par index.html, à la demande) ─
async function chargerJsPdf() {
  const classe = () => (window.jspdf && window.jspdf.jsPDF) || (typeof window.jsPDF === 'function' ? window.jsPDF : null)
  if (classe()) return classe()
  if (!window._BAIL_PDF_LIBS && typeof window.ensurePdfLibs === 'function') await window.ensurePdfLibs()
  const b64 = window._BAIL_PDF_LIBS && window._BAIL_PDF_LIBS.jspdf
  if (!b64) throw new Error('jsPDF indisponible')
  const bin = atob(b64)
  const octets = Uint8Array.from(bin, c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([octets], { type: 'text/javascript' }))
  await new Promise((resolve, reject) => {
    const sc = document.createElement('script')
    sc.src = url
    sc.onload = () => { URL.revokeObjectURL(url); resolve() }
    sc.onerror = () => { URL.revokeObjectURL(url); reject(new Error('jsPDF : échec de chargement')) }
    document.head.appendChild(sc)
  })
  const J = classe()
  if (!J) throw new Error('jsPDF non exposé')
  return J
}

// ── fenêtre de remise : composants et variables de l'app (thème clair/sombre), clavier, focus ──
const LIBELLES = { quittance: 'Quittance de loyer', edl: 'État des lieux', avenant: 'Avenant au bail' }

export function resumeDocument(doc) {
  const c = doc.champs || {}
  return [LIBELLES[doc.type] || 'Document', [c.bailleur, c.locataire].filter(Boolean).join(' et '), c.adresse].filter(Boolean)
}

export function afficherRemise(doc, telecharger) {
  const ov = document.createElement('div')
  ov.className = 'ov'; ov.id = 'ov-doc-express'
  const modal = document.createElement('div')
  modal.className = 'modal'; modal.style.maxWidth = '460px'
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'doc-express-titre')
  modal.tabIndex = -1
  const tete = document.createElement('div'); tete.className = 'm-head'
  const h = document.createElement('h3'); h.id = 'doc-express-titre'; h.style.margin = '0'; h.textContent = 'Document prêt'
  tete.append(h)
  const corps = document.createElement('div'); corps.className = 'm-body'
  const resume = document.createElement('div'); resume.className = 'mb8'
  resume.style.cssText = 'background:var(--sur2);border:1px solid var(--bor);border-radius:10px;padding:10px 12px;line-height:1.5'
  resumeDocument(doc).forEach((l, i) => { const p = document.createElement('div'); p.textContent = l; if (i === 0) p.style.fontWeight = '700'; resume.append(p) })
  const info = document.createElement('p'); info.className = 'mb8'
  info.textContent = 'Le document correspond à la saisie faite sur propryo.fr. Le PDF se télécharge en un clic.'
  const pied = document.createElement('div'); pied.className = 'flex-c'; pied.style.gap = '8px'
  const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'btn bp'; bt.textContent = 'Télécharger le PDF'
  const ba = document.createElement('button'); ba.type = 'button'; ba.className = 'btn bs'; ba.textContent = 'Annuler'
  for (const b of [bt, ba]) b.style.minHeight = '44px'
  pied.append(bt, ba)
  corps.append(resume, info, pied)
  modal.append(tete, corps); ov.append(modal)

  const precedent = document.activeElement
  const fermer = () => { document.removeEventListener('keydown', clavier, true); ov.remove(); try { precedent && precedent.focus && precedent.focus() } catch (e) {} }
  function clavier(e) {
    if (e.key === 'Escape') { e.preventDefault(); fermer(); return }
    if (e.key !== 'Tab') return
    const f = [...modal.querySelectorAll('button')]
    if (!f.length) return
    const premier = f[0], dernier = f[f.length - 1]
    if (e.shiftKey && (document.activeElement === premier || document.activeElement === modal)) { e.preventDefault(); dernier.focus() }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus() }
  }
  bt.onclick = () => {
    try { telecharger() } catch (e) { info.textContent = 'Le téléchargement a échoué. Il suffit de refaire le document depuis propryo.fr.'; return }
    info.textContent = MESSAGE_SUIVI
    bt.remove(); ba.textContent = 'Fermer'; ba.className = 'btn bp'; ba.focus()
  }
  ba.onclick = fermer
  document.addEventListener('keydown', clavier, true)
  document.body.append(ov)
  modal.focus()   // focus initial sur la fenêtre (titre lu), pas sur « Télécharger » : pas de clic involontaire
}

// ── point d'entrée, appelé une fois l'application affichée ──────────────────
const ESSAIS_MAX = 2
const MSG_REFUS = {
  taille: "Le document reçu de propryo.fr est trop volumineux : il n'a pas été retenu. Il suffit de le refaire avec des textes plus courts.",
  format: "Le document reçu de propryo.fr n'a pas pu être lu. Il suffit de le refaire depuis le site.",
  dpefg: "Avenant non établi : la majoration de loyer ne peut pas être appliquée dans un logement de classe énergétique F ou G (loi du 6 juillet 1989, article 17-1, III).",
}

// doc=attente n'a plus d'objet une fois la saisie traitée : il ne doit pas rejouer un document au prochain rechargement
export function retirerDocDeLUrl() {
  try {
    if (typeof location === 'undefined' || typeof history === 'undefined') return
    const u = new URL(location.href)
    if (!u.searchParams.has('doc')) return
    u.searchParams.delete('doc')
    history.replaceState(history.state, '', u.pathname + u.search + u.hash)
  } catch (e) {}
}

export async function consommerDocExpress({ storage = localStorage, charger = chargerJsPdf, afficher = afficherRemise, signaler } = {}) {
  const lu = lireEnAttente(storage)
  if (!lu) return false
  const prevenir = signaler || (m => { try { if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(m, 'err', 9000) } catch (_) {} })
  if (lu.erreur) { retirerDocDeLUrl(); prevenir(MSG_REFUS[lu.erreur] || MSG_REFUS.format); return false }
  const doc = lu.doc
  let brut = null
  try { brut = JSON.parse(storage.getItem(CLE_DOC_EXPRESS)) } catch (e) {}
  const essais = (brut && brut.essais) || 0
  // la clé est retirée AVANT l'essai (pas de boucle, pas de doublon d'un autre onglet) ; remise en cas d'échec
  // transitoire (réseau, libs PDF), au plus ESSAIS_MAX fois
  try { storage.removeItem(CLE_DOC_EXPRESS) } catch (e) {}
  try {
    const J = await charger()
    const { pdf, nom } = genererDocument(J, doc)
    retirerDocDeLUrl()
    afficher(doc, () => pdf.save(nom))
    return true
  } catch (e) {
    if (e && e.message === 'dpe-fg') { retirerDocDeLUrl(); prevenir(MSG_REFUS.dpefg); return false }
    try { console.warn('[doc-express]', e) } catch (_) {}
    if (brut && essais + 1 < ESSAIS_MAX) { try { storage.setItem(CLE_DOC_EXPRESS, JSON.stringify({ ...brut, essais: essais + 1 })) } catch (_) {} }
    prevenir("Le document n'a pas pu être généré. Il suffit de le refaire depuis propryo.fr.")
    return false
  }
}
