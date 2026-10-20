/**
 * core/premiers-pas.js — ACCUEIL D'UN NOUVEL UTILISATEUR : liste « Premiers pas » + visite guidée.
 * CDC : docs/CDC-PREMIERS-PAS.md (option C, GO Didier 15/10/2026, décisions D1 → D15).
 *
 * Ce module décide TOUT ce qui n'est pas de l'affichage :
 *  - les étapes de la liste, leur ordre, et quand chacune est faite — lu sur les DONNÉES du compte, jamais une
 *    case cochée à la main (le logement existe, un mouvement vient de la banque, un accès locataire est émis…) ;
 *  - qui voit la liste (D11) et qui reçoit la visite automatiquement (D1) ;
 *  - la progression enregistrée pour la bêta (D5) : date PREMIÈRE de chaque étape, « avant » quand l'étape était
 *    déjà faite à la première évaluation, repli 7 jours après la dernière étape (D10), masquer / afficher ;
 *  - l'opposition à la mesure (D6) : on ne garde alors que ce qui sert à l'écran ;
 *  - les textes et transitions de la visite, et le placement de la bulle ;
 *  - les statistiques que le pilotage tire des comptes (aucun nombre de testeurs figé : on compte ce qui existe).
 *
 * Module PUR : ni DB globale ni DOM. Les fonctions de progression RENVOIENT un nouvel objet (jamais de mutation) ;
 * l'appelant (js/app/premiers-pas-app.js) l'enregistre dans DB.params.premiersPas.
 */
import { estDeLEspacePropre } from './regul-validation.js'

export const VERSION = 1
export const DELAI_REPLI_JOURS = 7
const JOUR_MS = 864e5

const vivant = (x) => !!x && typeof x === 'object' && !x._deleted
const tableau = (v) => (Array.isArray(v) ? v : [])
const valeurs = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.values(o) : tableau(o))
const propreA = (espacePropre) => (rec) => estDeLEspacePropre(rec, espacePropre === undefined ? {} : { espacePropre })

/** Type de structure : une SCI (mot entier « SCI ») ou une « société civile ». */
export function estSCI(type) {
  const t = String(type || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /(^|[^a-z])sci([^a-z]|$)/.test(t) || /societe civile/.test(t)
}

// ─────────────────────────── E · Étapes ───────────────────────────
// Ordre = chemin le plus court vers la valeur : le dû (logement → bail), le payé (relevé, puis règle qui classe
// seule les imports suivants, D15), ce qui distingue Propryo (espace locataire ; plafond + artisan qui rendent le
// circuit d'un incident autonome), enfin le partage (SCI seulement).
export const ETAPES = Object.freeze([
  { id: 'logement', court: 'Logement', titre: 'Ajouter un logement', sous: 'Par l’adresse ou l’acte notarié en PDF ; risques et DPE retrouvés.', cta: 'Ajouter un logement' },
  { id: 'bail', court: 'Bail', titre: 'Créer le bail ou reprendre un bail en cours', sous: 'Le loyer dû part du bail : quittances, révisions et relances en découlent.', cta: 'Créer le bail' },
  { id: 'releve', court: 'Relevé bancaire', titre: 'Importer un relevé bancaire', sous: 'Fichier OFX, QFX ou XLSX de la banque : les loyers reçus sont rapprochés du bail.', cta: 'Importer le relevé' },
  { id: 'regle', court: 'Règle d’import', titre: 'Mémoriser une règle d’import', sous: 'Depuis une ligne du relevé : les lignes semblables seront classées seules aux prochains imports.', cta: 'Mémoriser une règle' },
  { id: 'espace', court: 'Espace locataire', titre: 'Ouvrir l’espace du locataire', sous: 'Un lien sans mot de passe : documents signés, quittances, messages, incidents.', cta: 'Ouvrir l’espace', apres: 'bail', cloud: true },
  { id: 'plafond', court: 'Plafond', titre: 'Fixer le plafond d’intervention', sous: 'Sous ce montant, un artisan intervient sans attendre de validation (300 € TTC proposés).', cta: 'Fixer le plafond' },
  { id: 'artisan', court: 'Artisan', titre: 'Ajouter un artisan au carnet', sous: 'Plombier, électricien, chauffagiste : prévenu directement quand un incident le concerne.', cta: 'Ajouter un artisan' },
  { id: 'associe', court: 'Associé', titre: 'Inviter un associé de la SCI', sous: 'En lecture ou en écriture, SCI par SCI.', cta: 'Inviter un associé', cloud: true, sci: true },
].map(Object.freeze))

const DETECTION = {
  logement: (d) => d.logements.some(vivant),
  bail: (d) => d.baux.some(vivant),
  releve: (d) => d.mouvements.some((m) => vivant(m) && m._source === 'bank_import'),
  regle: (d) => d.regles.some(vivant),
  espace: (d, x) => Number(x.accesLocataire) > 0,
  plafond: (d) => d.entites.some((e) => vivant(e) && e.incidentReglages && !!e.incidentReglages.valideLe),
  artisan: (d) => d.artisans.some((a) => vivant(a) && a.source !== 'migration'),
  associe: (d, x) => Number(x.invitations) > 0,
}

/** Les données du compte qui comptent : celles de l'espace PROPRE (une SCI partagée par un autre ne coche rien). */
function donneesPropres(D, espacePropre) {
  const p = propreA(espacePropre), src = D || {}
  return {
    entites: tableau(src.entites).filter(p),
    logements: tableau(src.logements).filter(p),
    baux: valeurs(src.baux).filter(p),
    mouvements: tableau(src.mouvements).filter(p),
    regles: tableau(src.importRules),            // configuration de l'espace propre seulement (store-multi)
    artisans: tableau(src.artisans).filter(p),
  }
}

/**
 * La liste, état courant.
 * @param {object} D — la base (DB)
 * @param {{cloud?:boolean, accesLocataire?:number|null, invitations?:number|null, espacePropre?:string}} ext
 *   ce que l'app ne sait qu'avec le cloud ; un nombre encore inconnu (null) = pas fait, jamais une erreur.
 */
export function etapesPremiersPas(D, ext) {
  const x = ext || {}
  const d = donneesPropres(D, x.espacePropre)
  const aUneSCI = d.entites.some((e) => vivant(e) && estSCI(e.type))
  const liste = ETAPES
    .filter((e) => (!e.cloud || x.cloud) && (!e.sci || aUneSCI))
    .map((e) => ({ id: e.id, court: e.court, titre: e.titre, sous: e.sous, cta: e.cta, apres: e.apres || null, fait: !!DETECTION[e.id](d, x) }))
  for (const e of liste) e.bloque = !!(e.apres && !e.fait && !liste.some((y) => y.id === e.apres && y.fait))
  const faits = liste.filter((e) => e.fait).length
  return { liste, faits, total: liste.length, suivante: liste.find((e) => !e.fait && !e.bloque) || null, fini: faits === liste.length }
}

// ─────────────────────────── V · Qui voit quoi ───────────────────────────
/** D11 — un associé invité sans structure propre ne voit pas la liste (ses étapes concernent le propriétaire). */
export function listeVisible(D, ext) {
  const x = ext || {}
  const ents = tableau((D || {}).entites).filter(vivant)
  if (!ents.length) return true
  return ents.some(propreA(x.espacePropre))
}

/**
 * Première évaluation du compte (données chargées). D1 : visite proposée seulement si aucun logement propre.
 * Les étapes déjà faites sont datées de maintenant et marquées « avant » : exclues des statistiques de la bêta.
 */
export function initialiser(D, ext, maintenant) {
  const e = etapesPremiersPas(D, ext)
  const neuf = !donneesPropres(D, (ext || {}).espacePropre).logements.some(vivant)
  const etapes = {}
  for (const s of e.liste) if (s.fait) etapes[s.id] = { le: maintenant, avant: true }
  const pp = { v: VERSION, creeLe: maintenant, mesure: true, visite: { etat: neuf ? 'a_proposer' : 'non_proposee' }, etapes }
  if (e.fini) { pp.termineLe = maintenant; pp.termineAvant = true }   // déjà tout fait : rien à montrer
  return pp
}

// ─────────────────────────── P · Progression ───────────────────────────
/** Ajoute la date PREMIÈRE de chaque étape nouvellement faite, et termineLe à la première complétude. */
export function majProgression(pp, etat, maintenant) {
  if (!pp) return { pp, change: false }
  let change = false
  const n = { ...pp, etapes: { ...(pp.etapes || {}) } }
  if (pp.mesure !== false) {
    for (const s of etat.liste) if (s.fait && !n.etapes[s.id]) { n.etapes[s.id] = { le: maintenant }; change = true }
  }
  if (etat.fini && !n.termineLe) { n.termineLe = maintenant; change = true }
  return change ? { pp: n, change } : { pp, change }
}

/** La liste s'affiche-t-elle sur l'accueil ? (masquée, ou repliée 7 jours après la dernière étape → non) */
export function doitAfficherListe(pp, etat, maintenant) {
  if (!pp) return false
  if (pp.masqueLe) return false
  if (pp.afficheLe) return true
  if (pp.termineAvant) return false
  if (pp.termineLe && etat && etat.fini) return (Date.parse(maintenant) - Date.parse(pp.termineLe)) < DELAI_REPLI_JOURS * JOUR_MS
  return true
}
// Opposition à la mesure (D6) : on ne garde que le fait (true), pas l'heure du geste.
const horo = (pp, maintenant) => (pp && pp.mesure === false ? true : maintenant)
export const masquer = (pp, maintenant) => { const n = { ...pp, masqueLe: horo(pp, maintenant) }; delete n.afficheLe; return n }
/** Réaffichage demandé (Mon profil) : vaut aussi après le repli automatique. */
export const afficher = (pp, maintenant) => { const n = { ...pp, afficheLe: horo(pp, maintenant || new Date().toISOString()) }; delete n.masqueLe; return n }

// ─────────────────────────── M · Mesure (D6) ───────────────────────────
/** Opposition : on efface dates, date de création et compteur ; seul le fonctionnement de l'écran reste. */
// Retour à la mesure (état de la liste fourni) : les étapes DÉJÀ faites sont marquées « avant », comme à la première évaluation —
// elles ne gonflent pas les statistiques de la bêta.
export function reglerMesure(pp, oui, etat, maintenant) {
  const n = { ...pp, mesure: !!oui, etapes: {}, visite: { ...((pp && pp.visite) || {}) } }
  if (!oui) {
    delete n.creeLe; delete n.visite.relances; delete n.visite.le
    if (n.masqueLe) n.masqueLe = true
    if (n.afficheLe) n.afficheLe = true
    return n
  }
  for (const s of ((etat && etat.liste) || [])) if (s.fait) n.etapes[s.id] = { le: maintenant, avant: true }
  return n
}

// ─────────────────────────── T · Visite ───────────────────────────
export const VISITE = Object.freeze([
  { k: 'intro', titre: 'Bienvenue sur Propryo',
    txt: 'Six étapes, une minute : où regarder chaque jour, où se trouvent les logements, et ce que Propryo prend en charge entre le locataire, l’artisan et le propriétaire.' },
  { k: 'presse', titre: 'Ce qui presse',
    txt: 'Le premier endroit à regarder. Propryo trie ce qui demande une décision : loyer impayé, révision, dépôt à restituer, document à renouveler. Quand rien n’attend, chaque bulle affiche « À jour ».',
    txtTel: '« À regarder » rassemble ce qui demande une décision : loyer impayé, révision, dépôt à restituer, document à renouveler. Quand rien n’attend, la carte affiche « tout est à jour ».' },
  { k: 'biens', titre: 'Les logements',
    txt: 'Tout part du logement. L’ajouter une fois, par l’adresse ou l’acte notarié en PDF : Propryo détecte les risques de l’adresse, retrouve le DPE par son numéro, puis prépare le bail au contrat type.' },
  { k: 'espace', titre: 'L’espace du locataire',
    txt: 'Chaque locataire reçoit un lien personnel, sans mot de passe : bail et états des lieux signés, quittances, messages, signalement d’un incident. Les documents définitifs y sont déposés automatiquement.' },
  { k: 'incident', titre: 'Les incidents, sans tout gérer soi-même', ia: true,
    txt: 'Le locataire signale l’incident, aidé par l’IA. Un artisan du carnet reçoit la demande et intervient sous le plafond fixé une fois ; au-delà, son devis attend une validation. La cause et « qui paie » s’affichent à la fin, avec le texte de loi.' },
  { k: 'edl', titre: 'L’état des lieux dicté', ia: true,
    txt: 'Dicter pièce par pièce : l’IA transcrit et propose l’état de chaque élément. Chaque ligne se relit, se corrige ou s’ignore, puis les deux parties signent sur place.' },
  { k: 'candidats', titre: 'Les dossiers des candidats',
    txt: 'Les candidats déposent leur dossier par un lien, sans compte. Propryo vérifie le code 2D-Doc des pièces et signale des constats factuels et datés, jamais une note sur la personne. La décision reste au propriétaire.',
    txtTel: 'Dans « Plus », puis « Locataires » : les candidats déposent leur dossier par un lien, sans compte. Propryo vérifie le code 2D-Doc des pièces et signale des constats factuels et datés, jamais une note sur la personne.' },
].map(Object.freeze))
export const MENTION_IA = 'Proposé par l’IA, toujours relu par une personne.'
const DERNIERE = VISITE.length - 1
const borne = (i) => Math.max(0, Math.min(DERNIERE, Math.round(Number(i) || 0)))

export const doitLancerVisite = (pp) => !!(pp && pp.visite && (pp.visite.etat === 'a_proposer' || pp.visite.etat === 'en_cours'))
export const etapeDeReprise = (pp) => (pp && pp.visite && pp.visite.etat === 'en_cours' ? borne(pp.visite.etape) : 0)
export function visiteEtape(pp, i, maintenant) {
  return { ...pp, visite: { ...(pp.visite || {}), etat: 'en_cours', etape: borne(i), ...(pp.mesure !== false ? { le: maintenant } : {}) } }
}
export function visiteFin(pp, mode, maintenant) {
  const etat = mode === 'finie' ? 'finie' : 'passee'
  return { ...pp, visite: { ...(pp.visite || {}), etat, ...(pp.mesure !== false ? { le: maintenant } : {}) } }
}
export function visiteRelancer(pp, maintenant) {
  const v = { ...(pp.visite || {}), etat: 'en_cours', etape: 1 }
  if (pp.mesure !== false) { v.relances = (Number(v.relances) || 0) + 1; v.le = maintenant }
  return { ...pp, visite: v }
}

// ─────────────────────────── B · Placement de la bulle ───────────────────────────
/**
 * À droite de la cible (barre latérale du PC), sinon dessous, sinon dessus — jamais sur la zone commentée.
 * Au téléphone : pleine largeur (12 px de marge) et jamais sur la barre du bas.
 * @returns {{left:number, top:number, cote:'droite'|'dessous'|'dessus', flecheDecalage:number}}
 */
export function placerBulle({ cible, bulle, vue, barreBas, tel }) {
  const M = 12, G = 14
  const bw = bulle.width, bh = bulle.height
  const cDroite = cible.left + cible.width, cBas = cible.top + cible.height
  const limBas = Math.min(vue.h, barreBas && barreBas.height > 0 ? barreBas.top : vue.h)
  let cote, left, top
  if (!tel && cible.left < vue.l * 0.3 && cDroite + 16 + bw <= vue.l - M) {
    cote = 'droite'; left = cDroite + 16
    top = Math.min(Math.max(M, cible.top + cible.height / 2 - bh / 2), vue.h - bh - M)
  } else if (cBas + G + bh <= limBas - M) {
    cote = 'dessous'; top = cBas + G
  } else {
    cote = 'dessus'; top = Math.max(M, Math.min(cible.top, limBas) - G - bh)
  }
  if (cote !== 'droite') left = tel ? M : Math.min(Math.max(M, cible.left + cible.width / 2 - bw / 2), vue.l - bw - M)
  const flecheDecalage = cote === 'droite'
    ? Math.round(Math.min(Math.max(16, cible.top + cible.height / 2 - top - 7), bh - 30))
    : Math.round(Math.min(Math.max(16, cible.left + cible.width / 2 - left - 7), bw - 30))
  return { left: Math.round(left), top: Math.round(top), cote, flecheDecalage }
}

// ─────────────────────────── S · Statistiques de la bêta ───────────────────────────
/**
 * @param {{email:string, inscritLe?:string, pp:object|null}[]} lignes — un compte inscrit par ligne
 * Les comptes opposés à la mesure (D6) ne sont comptés que dans `opposition`. Les étapes « avant » sont exclues.
 */
export function statsPremiersPas(lignes) {
  const s = { inscrits: 0, sansDonnees: 0, opposition: 0, visite: { finie: 0, passee: 0, en_cours: 0, a_proposer: 0, non_proposee: 0 }, miseEnRouteComplete: 0, parEtape: {}, delaiMedianJours: null }
  const delais = []
  for (const l of tableau(lignes)) {
    s.inscrits++
    const pp = l && l.pp
    if (!pp) { s.sansDonnees++; continue }
    if (pp.mesure === false) { s.opposition++; continue }
    const ev = pp.visite && pp.visite.etat
    if (ev && Object.prototype.hasOwnProperty.call(s.visite, ev)) s.visite[ev]++
    const etapes = pp.etapes || {}
    for (const [id, v] of Object.entries(etapes)) if (v && !v.avant) s.parEtape[id] = (s.parEtape[id] || 0) + 1
    const toutAvant = Object.values(etapes).length > 0 && Object.values(etapes).every((v) => v && v.avant)
    if (pp.termineLe && !toutAvant) {
      s.miseEnRouteComplete++
      const dep = Date.parse(l.inscritLe || pp.creeLe)
      if (!isNaN(dep)) delais.push((Date.parse(pp.termineLe) - dep) / JOUR_MS)
    }
  }
  if (delais.length) {
    delais.sort((a, b) => a - b)
    const m = delais.length >> 1
    s.delaiMedianJours = Math.round((delais.length % 2 ? delais[m] : (delais[m - 1] + delais[m]) / 2) * 10) / 10
  }
  return s
}
