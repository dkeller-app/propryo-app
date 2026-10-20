/**
 * core/incident-circuit.js — CIRCUIT D'UN INCIDENT : locataire → artisan → fin (CDC docs/CDC-INCIDENT-CIRCUIT.md).
 *
 * Helpers PURS (aucun DOM, aucun réseau, aucune DB) :
 *   - constat NEUTRE de l'artisan (6 constats, 3 ampleurs) → entrée du moteur qui-paie.js, dont les règles
 *     ne changent pas (§ 5 du CDC, décisions D9, D10, D11) ;
 *   - étapes vues du locataire (Signalé → Intervention prévue → Terminé) ;
 *   - plafond d'intervention directe par structure et par métier, décision sur un devis (D1, D3) ;
 *   - carnet d'artisans (table `artisans`, migration 0060) : couverture d'un métier, artisan à prévenir,
 *     dernière intervention, migration du carnet calculé d'avant (D5) ;
 *   - entreprises suggérées : annuaire officiel `/near_point`, liste RGE par distance, tri (D7, D8) ;
 *   - accord exprès du locataire pour un créneau un samedi, un dimanche ou un jour férié (art. 7 e, D12) ;
 *   - demande MINIMISÉE envoyée à l'artisan (D13), expiration de son lien (D14) ;
 *   - résultat publié au locataire après la validation du propriétaire.
 * On LISTE, on ne recommande pas ; aucun montant n'est calculé ici (la dépense passe par _mvCreate).
 */
import { quiPaie, TEXTES, PAYEURS, PAYEUR_LBL } from './qui-paie.js'
import { NAF_METIERS, RGE_BASE } from './incidents.js'

const _s = (v) => (v == null ? '' : String(v))
const _norm = (v) => _s(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
const _iso = (v) => { if (v == null || v === '') return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d }

/* ─────────────── Constat neutre (artisan, ou facture lue confirmée par le propriétaire) ─────────────── */

export const CONSTATS = Object.freeze([
  { k: 'usure', lbl: 'Pièce usée par le temps' },
  { k: 'entretien_non_fait', lbl: 'Entretien courant non fait' },
  { k: 'casse', lbl: 'Pièce cassée (choc, mauvais usage)' },
  { k: 'defaut', lbl: 'Défaut de l\'appareil ou de l\'installation' },
  { k: 'exterieure', lbl: 'Cause extérieure (voisin, intempérie)' },
  { k: 'sinistre', lbl: 'Sinistre (assurance)' },
])
export const SOUS_TYPES_EXTERIEURE = Object.freeze([
  { k: 'tiers', lbl: 'Un voisin, une autre personne' },
  { k: 'evenement', lbl: 'Une intempérie, un événement' },
])
export const AMPLEURS = Object.freeze([
  { k: 'petite', lbl: 'Petite réparation' },
  { k: 'complet', lbl: 'Remplacement complet' },
  { k: 'entretien', lbl: 'Entretien ou réglage' },
])
export const SOURCES_CONSTAT = Object.freeze(['artisan', 'facture', 'proprietaire'])
const _lbl = (liste, k) => ((liste.find((x) => x.k === k) || {}).lbl) || ''
export const constatLbl = (k) => _lbl(CONSTATS, k)
export const ampleurLbl = (k) => _lbl(AMPLEURS, k)

const INTERVENTION_DE_AMPLEUR = Object.freeze({ petite: 'petite_piece', complet: 'remplacement_complet', entretien: 'entretien' })

/**
 * Constat + ampleur → { cause, intervention } du moteur qui-paie.js (CDC § 5). null si le constat est inconnu.
 *   usure + petite réparation → usage normal (réparation locative si l'élément est dans la liste du décret) ;
 *   usure + remplacement complet → vétusté (bailleur) — D9 ;
 *   pièce cassée → art. 7 c (présomption, exceptions citées), jamais libellé « faute » — D10 ;
 *   cause extérieure → fait d'un tiers (une personne) ou force majeure (un événement).
 */
export function entreeMoteur({ constat, sousType, ampleur } = {}) {
  if (!CONSTATS.some((c) => c.k === constat)) return null
  const intervention = INTERVENTION_DE_AMPLEUR[ampleur] || 'inconnue'
  let cause
  switch (constat) {
    case 'usure': cause = ampleur === 'complet' ? 'vetuste' : 'usage_normal'; break
    case 'entretien_non_fait': cause = 'defaut_entretien'; break
    case 'casse': cause = 'faute_locataire'; break
    case 'defaut': cause = 'malfacon_vice'; break
    case 'exterieure': cause = sousType === 'evenement' ? 'force_majeure' : 'tiers'; break
    default: cause = 'sinistre'
  }
  return { cause, intervention }
}

/** Libellés de cause AFFICHÉS (jamais « faute ») — le moteur garde ses clés. */
const CAUSE_AFFICHEE = Object.freeze({
  inconnue: 'Non établie', usage_normal: 'Usure liée à un usage normal', vetuste: 'Vétusté (élément usé par le temps)',
  faute_locataire: 'Dégradation survenue pendant le bail', defaut_entretien: 'Entretien courant non fait',
  malfacon_vice: 'Défaut de l\'appareil ou de l\'installation', sinistre: 'Sinistre', force_majeure: 'Cause extérieure (événement)',
  tiers: 'Fait d\'un tiers',
})
export const causeAffichee = (k) => CAUSE_AFFICHEE[k] || CAUSE_AFFICHEE.inconnue

/** Constat normalisé (ce qui est enregistré sur l'incident). null si invalide. */
export function normaliserConstat(c, now) {
  const x = c || {}
  if (!CONSTATS.some((k) => k.k === x.constat)) return null
  return {
    constat: x.constat,
    sousType: x.constat === 'exterieure' ? (SOUS_TYPES_EXTERIEURE.some((s) => s.k === x.sousType) ? x.sousType : 'tiers') : null,
    ampleur: AMPLEURS.some((a) => a.k === x.ampleur) ? x.ampleur : null,
    resume: _s(x.resume).trim().slice(0, 1000),
    source: SOURCES_CONSTAT.includes(x.source) ? x.source : 'proprietaire',
    le: x.le || now || new Date().toISOString(),
  }
}

/**
 * Verdict du moteur pour un incident et son constat (règles inchangées). Les champs de l'incident (élément,
 * nature, urgences, contexte) viennent du signalement ; la cause et l'intervention, du constat.
 */
export function verdictDuConstat(inc, constat) {
  const e = entreeMoteur(constat || {})
  if (!inc || !e) return null
  return quiPaie({ element: inc.element, nature: inc.nature, urgences: inc.urgences, contexte: inc.contexte, cause: e.cause, intervention: e.intervention })
}

/* ─────────────── Ce que voit le locataire (aucune cause, aucun coût avant la fin) ─────────────── */

export const ETAPES_LOCATAIRE = Object.freeze([
  { k: 'signale', lbl: 'Signalé' }, { k: 'intervention', lbl: 'Intervention prévue' }, { k: 'termine', lbl: 'Terminé' },
])
export function etapeLocataire({ statut, creneau, resultatPublie } = {}) {
  if (resultatPublie || statut === 'resolu') return 'termine'
  if ((creneau && creneau.date) || statut === 'en_cours') return 'intervention'
  return 'signale'
}

/* ─────────────── Plafond d'intervention directe (D1, D2, D3) ─────────────── */

export const PLAFOND_DEFAUT = 300
export const PLAFOND_MAX = 100000
/** « 1 180,50 € » → 1180.5 ; vide ou invalide → null. Jamais négatif. */
export function montant(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
  const t = _s(v).replace(/[\s  €]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100) / 100
}
/** Réglages d'une structure (stockés sur l'entité : entite.incidentReglages). */
export function normaliserReglages(r) {
  const x = r || {}
  const m = montant(x.plafondTtc)
  const parMetier = {}
  for (const [k, v] of Object.entries(x.parMetier || {})) { const n = montant(v); if (NAF_METIERS[k] && n != null && n <= PLAFOND_MAX) parMetier[k] = n }
  return {
    plafondTtc: m != null && m <= PLAFOND_MAX ? m : PLAFOND_DEFAUT,
    parMetier,
    conserverPieces: x.conserverPieces === true,
    valideLe: x.valideLe || null,
    validePar: _s(x.validePar) || null,
  }
}
/** Plafond applicable à un métier : 0 tant que le propriétaire ne l'a pas validé (tout passe alors par devis). */
export function plafondPour(reglages, metier) {
  const r = normaliserReglages(reglages)
  if (!r.valideLe) return 0
  return Object.prototype.hasOwnProperty.call(r.parMetier, metier) ? r.parMetier[metier] : r.plafondTtc
}
/** Devis déposé : accepté automatiquement sous le plafond (montant TTC + devis déjà acceptés sur la même intervention
 *  ≤ plafond > 0), sinon au propriétaire. Miroir de ar_document (0060). */
export function decisionDevis(montantTtc, plafondTtc, dejaAccepteTtc = 0) {
  const m = montant(montantTtc), p = montant(plafondTtc), d = montant(dejaAccepteTtc) || 0
  return (m != null && m > 0 && p != null && p > 0 && m + d <= p) ? 'auto_accepte' : 'en_attente'
}
export const STATUTS_DEVIS = Object.freeze({ auto_accepte: 'Accepté automatiquement (sous le plafond)', en_attente: 'En attente de la réponse du propriétaire', accepte: 'Accepté par le propriétaire', refuse: 'Refusé par le propriétaire' })
/** Phrase affichée à l'artisan (D1). */
export function phrasePlafond(p) {
  const m = montant(p)
  if (!m) return 'Aucune intervention sans accord : déposer un devis, réponse du propriétaire en 1 clic.'
  return `Intervention directe autorisée jusqu'à ${m.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} € TTC, déplacement compris, sans attendre de réponse. Au-delà : déposer un devis, réponse du propriétaire en 1 clic.`
}

/* ─────────────── Carnet d'artisans (table `artisans`, D5) ─────────────── */

const _siret = (v) => { const d = _s(v).replace(/\s/g, ''); return /^\d{14}$/.test(d) ? d : '' }
const _email = (v) => { const e = _s(v).trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : '' }
const _tel = (v) => { const t = _s(v).replace(/[^\d+]/g, ''); return /^\+?\d{9,15}$/.test(t) ? _s(v).trim().slice(0, 30) : '' }
export const NOTE_MAX = 2000

/** Artisan du carnet, forme stockée (DB.artisans). Champs inconnus ignorés. */
export function nouvelArtisan(f, now) {
  const x = f || {}
  return {
    id: x.id,
    entity: _s(x.entity).trim(),
    nom: _s(x.nom).trim().slice(0, 160),
    siret: _siret(x.siret),
    metiers: [...new Set((Array.isArray(x.metiers) ? x.metiers : (x.metier ? [x.metier] : [])).filter((m) => NAF_METIERS[m]))],
    tel: _tel(x.tel),
    email: _email(x.email),
    adresse: _s(x.adresse).trim().slice(0, 200),
    commune: _s(x.commune).trim().slice(0, 100),
    rge: x.rge === true,
    notePrivee: _s(x.notePrivee).slice(0, NOTE_MAX),
    prevenirAuto: x.prevenirAuto === true,
    source: ['carnet', 'annuaire', 'rge', 'libre', 'migration'].includes(x.source) ? x.source : 'libre',
    creeLe: x.creeLe || now || new Date().toISOString(),
  }
}
export const artisanCouvre = (a, metier) => !!metier && !!a && !a._deleted && Array.isArray(a.metiers) && a.metiers.includes(metier)
export const joignable = (a) => !!(a && (a.tel || a.email))

/** Date de la dernière intervention d'un artisan (incidents où il a été choisi), AAAA-MM-JJ ou ''. */
export function derniereIntervention(a, incidents) {
  if (!a) return ''
  let best = ''
  for (const i of Array.isArray(incidents) ? incidents : []) {
    if (!i || i._deleted) continue
    const c = i.circuit || {}
    const meme = (c.artisanId != null && String(c.artisanId) === String(a.id))
      || (i.artisan && ((a.siret && _siret(i.artisan.siret) === a.siret) || (!a.siret && _norm(i.artisan.nom) && _norm(i.artisan.nom) === _norm(a.nom))))
    if (!meme) continue
    const d = _s((i.statutDates && (i.statutDates.resolu || i.statutDates.en_cours)) || i.creeLe).slice(0, 10)
    if (d > best) best = d
  }
  return best
}
/** Artisans d'une structure qui couvrent un métier, le plus récemment intervenu d'abord. */
export function artisansPourMetier(artisans, { metier, entity, incidents } = {}) {
  return (Array.isArray(artisans) ? artisans : [])
    .filter((a) => artisanCouvre(a, metier) && (!entity || !a.entity || a.entity === entity))
    .map((a) => ({ a, d: derniereIntervention(a, incidents) }))
    .sort((x, y) => y.d.localeCompare(x.d) || x.a.nom.localeCompare(y.a.nom, 'fr'))
    .map((x) => x.a)
}
/** L'artisan que Propryo prévient directement (D6) : réglé « prévenir directement » et joignable. */
export function artisanAPrevenir(artisans, ctx) {
  return artisansPourMetier(artisans, ctx).find((a) => a.prevenirAuto && joignable(a)) || null
}
/**
 * Migration du carnet CALCULÉ d'avant 0060 (incidents.carnetArtisans) vers la table `artisans` : une fiche par
 * entreprise et par structure, jamais en double (SIRET, sinon nom normalisé). `entityDe(entree)` résout la structure.
 */
export function migrationCarnet(derive, existants, entityDe, now) {
  const cle = (a, ent) => (ent || '') + '|' + (a.siret ? 's:' + _siret(a.siret) : 'n:' + _norm(a.nom))
  const vus = new Set((Array.isArray(existants) ? existants : []).filter((a) => a && !a._deleted).map((a) => cle(a, a.entity)))
  const out = []
  for (const d of Array.isArray(derive) ? derive : []) {
    if (!d || !_s(d.nom).trim()) continue
    const ent = typeof entityDe === 'function' ? _s(entityDe(d)) : ''
    const k = cle({ siret: _siret(d.siret), nom: d.nom }, ent)
    if (vus.has(k)) continue
    vus.add(k)
    out.push(nouvelArtisan({ entity: ent, nom: d.nom, siret: d.siret, tel: d.tel, metiers: d.metier ? [d.metier] : [], source: 'migration' }, now))
  }
  return out
}

/* ─────────────── Entreprises suggérées (faits publics, D7, D8) ─────────────── */

export const NEAR_POINT_BASE = 'https://recherche-entreprises.api.gouv.fr/near_point'
export const RAYONS_KM = Object.freeze([2, 5, 10, 20])
export const SUGGESTIONS_MIN = 8
export const CRITERES = Object.freeze([
  'Métier : code d\'activité de l\'entreprise.',
  'Entreprise active dans l\'annuaire officiel (recherche-entreprises.api.gouv.fr).',
  'Distance du logement, à vol d\'oiseau.',
  'RGE (liste ADEME), affiché pour les travaux d\'énergie.',
  'Ancienneté (date de création).',
  'En tête : entreprises déjà utilisées par la structure ou ses associés.',
])
export const MENTION_SUGGESTIONS = 'Propryo liste selon des faits publics et ne recommande personne. Pas d\'avis de clients ni d\'assurance décennale : non vérifiables. Pas de commission.'

const _coord = (v) => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
export function distanceKm(lat1, lon1, lat2, lon2) {
  const a1 = _coord(lat1), o1 = _coord(lon1), a2 = _coord(lat2), o2 = _coord(lon2)
  if ([a1, o1, a2, o2].some((x) => x == null)) return null
  const r = Math.PI / 180
  const d = Math.sin((a2 - a1) * r / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin((o2 - o1) * r / 2) ** 2
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(d), Math.sqrt(1 - d)) * 10) / 10
}
/** URL de l'annuaire autour du logement. Seuls le code d'activité et un point (le logement) partent. */
export function urlNearPoint({ lat, lon, rayonKm = 5, metier, page = 1 } = {}) {
  const m = NAF_METIERS[metier]; const a = _coord(lat), o = _coord(lon)
  if (!m || a == null || o == null) return null
  const r = Math.min(50, Math.max(0.5, Number(rayonKm) || 5))
  const p = new URLSearchParams({ lat: a.toFixed(5), long: o.toFixed(5), radius: String(r), activite_principale: m.naf, per_page: '25', page: String(Math.max(1, page | 0)) })
  return NEAR_POINT_BASE + '?' + p.toString()
}
const _annee = (d) => (/^\d{4}/.test(_s(d)) ? Number(_s(d).slice(0, 4)) : null)
/**
 * Lit la réponse de /near_point : entreprises ACTIVES dont le code d'activité est celui du métier, établissement
 * ACTIF le plus proche du logement (un établissement fermé remonte parfois : écarté). Une ligne par entreprise.
 */
export function lireNearPoint(json, { lat, lon, naf } = {}) {
  const parSiren = new Map()
  for (const r of (json && json.results) || []) {
    if (!r || r.etat_administratif !== 'A' || (naf && r.activite_principale !== naf)) continue
    for (const e of [].concat(r.matching_etablissements || [])) {
      if (!e || e.etat_administratif !== 'A') continue
      const d = distanceKm(lat, lon, e.latitude, e.longitude)
      if (d == null) continue
      const siren = _s(r.siren)
      const prev = parSiren.get(siren)
      if (prev && prev.distanceKm <= d) continue
      parSiren.set(siren, {
        nom: _s(r.nom_complet || r.nom_raison_sociale).trim(),
        siren, siret: _siret(e.siret), adresse: _s(e.adresse).trim(), commune: _s(e.libelle_commune).trim(),
        distanceKm: d, creeLe: _s(r.date_creation).slice(0, 10), anneeCreation: _annee(r.date_creation),
        rge: !!((r.complements && r.complements.est_rge) || (Array.isArray(e.liste_rge) && e.liste_rge.length)),
        naf: _s(r.activite_principale), tel: '', email: '',
      })
    }
  }
  return [...parSiren.values()].filter((x) => x.nom && x.siret)
}
/** Tri : déjà utilisées en tête (dernière intervention la plus récente d'abord), puis distance, puis nom. */
export function trierSuggestions(liste, artisans, incidents) {
  const util = new Map()
  for (const a of Array.isArray(artisans) ? artisans : []) {
    if (!a || a._deleted || !a.siret) continue
    const d = derniereIntervention(a, incidents) || '0000-00-00'
    const k = a.siret.slice(0, 9); if (!util.has(k) || util.get(k) < d) util.set(k, d)
  }
  return (Array.isArray(liste) ? liste : []).map((x) => ({ ...x, dejaUtilise: util.has(_s(x.siret).slice(0, 9)), derniere: util.get(_s(x.siret).slice(0, 9)) || '' }))
    .sort((a, b) => (Number(b.dejaUtilise) - Number(a.dejaUtilise)) || b.derniere.localeCompare(a.derniere) || (a.distanceKm - b.distanceKm) || a.nom.localeCompare(b.nom, 'fr'))
}

/** Domaines RGE (liste ADEME, libellés exacts relevés le 14/10/2026) pertinents par métier. Vide = pas d'énergie. */
export const RGE_DOMAINES = Object.freeze({
  chauffage: ['Chaudière condensation ou micro-cogénération gaz ou fioul', 'Pompe à chaleur : chauffage', 'Chaudière bois', 'Poêle ou insert bois', 'Chauffage et/ou eau chaude solaire', 'Chauffe-Eau Thermodynamique', 'Ventilation mécanique'],
  plomberie: ['Chauffe-Eau Thermodynamique', 'Chauffage et/ou eau chaude solaire'],
  menuiserie: ['Fenêtres, volets, portes donnant sur l\'extérieur', 'Fenêtres de toit'],
  couverture: ['Isolation des toitures terrasses ou des toitures par l\'extérieur', 'Isolation des combles perdus', 'Fenêtres de toit'],
  electricite: ['Radiateurs électriques, dont régulation.', 'Panneaux solaires photovoltaïques'],
})
export const metierEnergie = (m) => (RGE_DOMAINES[m] || []).length > 0
/** URL de la liste RGE autour du logement (triée par distance par le service). */
export function urlRgeGeo({ lat, lon, rayonKm = 10, metier } = {}) {
  const dom = RGE_DOMAINES[metier] || []; const a = _coord(lat), o = _coord(lon)
  if (!dom.length || a == null || o == null) return null
  const p = new URLSearchParams({
    size: '100', geo_distance: `${o.toFixed(5)},${a.toFixed(5)},${Math.min(50, Math.max(1, Number(rayonKm) || 10))}km`,
    qs: dom.map((d) => 'domaine:"' + d.replace(/"/g, '') + '"').join(' OR '),
    select: 'nom_entreprise,siret,adresse,commune,code_postal,telephone,email,site_internet,domaine,lien_date_fin',
  })
  return RGE_BASE + '?' + p.toString()
}
/** Lit la liste RGE : qualifications en cours de validité, une ligne par SIRET (domaines regroupés), ordre du service. */
export function lireRgeGeo(json, aujourdhui) {
  const today = _s(aujourdhui).slice(0, 10)
  const out = new Map()
  for (const r of (json && json.results) || []) {
    const siret = _siret(r && r.siret); if (!siret || !_s(r.nom_entreprise).trim()) continue
    if (today && r.lien_date_fin && _s(r.lien_date_fin).slice(0, 10) < today) continue
    const cur = out.get(siret) || { siret, siren: siret.slice(0, 9), nom: _s(r.nom_entreprise).trim(), tel: _tel(r.telephone), email: _email(r.email), commune: _s(r.commune).trim(), domaines: [], distanceKm: Number.isFinite(Number(r._geo_distance)) ? Math.round(Number(r._geo_distance) / 100) / 10 : null }
    if (r.domaine && !cur.domaines.includes(r.domaine)) cur.domaines.push(r.domaine)
    out.set(siret, cur)
  }
  return [...out.values()]
}
/** Enrichit les entreprises de l'annuaire avec la liste RGE (même SIREN) : badge RGE + téléphone et e-mail publics (D8). */
export function fusionnerRge(liste, rge) {
  const parSiren = new Map((Array.isArray(rge) ? rge : []).map((x) => [x.siren, x]))
  return (Array.isArray(liste) ? liste : []).map((x) => {
    const r = parSiren.get(_s(x.siret).slice(0, 9))
    return r ? { ...x, rge: true, tel: x.tel || r.tel, email: x.email || r.email, domaines: r.domaines } : x
  })
}
/** Avis : simple lien vers une recherche cartographique publique (aucune API, rien n'est récupéré — CDC § 13). */
export const lienAvisEnLigne = (nom, commune) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([_s(nom).trim(), _s(commune).trim()].filter(Boolean).join(' '))
export const lienFicheOfficielle = (siret) => { const s = _siret(siret); return s ? 'https://annuaire-entreprises.data.gouv.fr/etablissement/' + s : null }

/* ─────────────── Créneau : accord exprès du locataire (art. 7 e, D12) ─────────────── */

function _paques(an) {   // algorithme de Meeus/Jones/Butcher (calendrier grégorien)
  const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(an, mois - 1, jour)
}
const _jj = (t) => new Date(t).toISOString().slice(5, 10)
/** Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle) : Vendredi saint et 26 décembre en plus. */
export const alsaceMoselle = (codePostal) => /^(57|67|68)\d{3}$/.test(_s(codePostal).replace(/\s/g, ''))
/** Jours fériés légaux (code du travail, art. L3133-1 ; Alsace-Moselle, art. L3134-13) d'une date AAAA-MM-JJ. */
export function estJourFerie(date, { alsaceMoselle: am = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(_s(date).slice(0, 10)); if (!m) return false
  const an = Number(m[1]), md = m[2] + '-' + m[3]
  const fixes = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].concat(am ? ['12-26'] : [])
  if (fixes.includes(md)) return true
  const p = _paques(an), j = 86400000
  const mobiles = [p + j, p + 39 * j, p + 50 * j].concat(am ? [p - 2 * j] : []).map(_jj)
  return mobiles.includes(md)
}
/** Un créneau ce jour-là exige-t-il l'accord exprès du locataire ? { exige, motif: 'samedi'|'dimanche'|'ferie'|null } */
export function exigeAccordExpres(date, codePostal) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(_s(date).slice(0, 10)); if (!m) return { exige: false, motif: null }
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
  if (dow === 6) return { exige: true, motif: 'samedi' }
  if (dow === 0) return { exige: true, motif: 'dimanche' }
  if (estJourFerie(date, { alsaceMoselle: alsaceMoselle(codePostal) })) return { exige: true, motif: 'ferie' }
  return { exige: false, motif: null }
}
export const ART_7E_WEEKEND = 'Aucuns travaux ne peuvent être réalisés les samedis, dimanches et jours fériés sans l\'accord exprès du locataire.'
export const ART_7E_SOURCE = 'Loi n° 89-462 du 6 juillet 1989, art. 7 e) — Légifrance'
/** Créneau proposé par l'artisan : { date: AAAA-MM-JJ, debut: HH:MM, fin: HH:MM } ou null. */
export function normaliserCreneau(c) {
  const x = c || {}
  const d = _s(x.date).slice(0, 10), hm = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T00:00:00Z'))) return null
  const debut = hm.test(_s(x.debut)) ? x.debut : null, fin = hm.test(_s(x.fin)) ? x.fin : null
  if (debut && fin && fin <= debut) return null
  return { date: d, debut, fin }
}

/* ─────────────── Lien de l'artisan (D13, D14) ─────────────── */

export const LIEN_JOURS_APRES_VALIDATION = 30
export const LIEN_JOURS_MAX = 90
/** Fin de validité : 30 jours après la validation finale, et jamais plus de 90 jours après l'émission. */
export function expirationLien(emisLe, valideLe) {
  const e = _iso(emisLe); if (!e) return null
  const max = new Date(e.getTime() + LIEN_JOURS_MAX * 86400000)
  const v = _iso(valideLe)
  const fin = v ? new Date(Math.min(max.getTime(), v.getTime() + LIEN_JOURS_APRES_VALIDATION * 86400000)) : max
  return fin.toISOString()
}
/**
 * Ce que reçoit l'artisan (données MINIMISÉES, D13) : le problème, le lieu, l'accès, le contact du locataire —
 * son téléphone SEULEMENT s'il l'a accepté. Rien sur le bail, le loyer, les autres biens ni « qui paie ».
 */
export function demandeArtisan({ inc, signalement, adresse, locataireNom, elementLbl, photos } = {}) {
  const s = signalement || {}
  const urg = Array.isArray(inc && inc.urgences) && inc.urgences.length > 0
  return {
    titre: _s(elementLbl || (inc && (inc.elementLibre || inc.element)) || 'Intervention').slice(0, 160),
    description: _s((s.ia && s.ia.resume) || s.description || (inc && inc.description)).slice(0, 2000),
    urgent: urg,
    adresse: _s(adresse).slice(0, 300),
    acces: _s(s.acces_info).slice(0, 300),
    presence: _s(s.presence).slice(0, 300),
    locataire: _s(locataireNom).slice(0, 120),
    telephone: s.tel_partage === true ? _s(s.telephone).slice(0, 30) : '',
    photos: (Array.isArray(photos) ? photos : []).filter((p) => p && typeof p.path === 'string').slice(0, 6).map((p) => ({ path: p.path, nom: _s(p.nom).slice(0, 120) || 'photo' })),
    signaleLe: _s((inc && inc.creeLe) || s.cree_le),
  }
}

/** E-mail (ou SMS) d'invitation de l'artisan : neutre, aucune donnée personnelle ni montant dans l'objet. */
export function modeleEmailArtisan({ bailleur, lien } = {}) {
  const b = _s(bailleur).trim() || 'Le propriétaire'
  if (!/^https:\/\//.test(_s(lien))) return null
  return {
    objet: 'Demande d\'intervention',
    texte: `Bonjour,\n\n${b} demande une intervention. Le détail (adresse, problème, photos, montant autorisé sans accord préalable) est sur cette page, sans compte ni mot de passe :\n${lien}\n\nLa même page sert à proposer un créneau, à déposer le devis puis la facture.\nLe lien est personnel : ne pas le transférer.\n\n— Propryo, pour ${b}\nMessage automatique : ne pas répondre à cet e-mail.`,
    sms: `${b} : demande d'intervention (détail, créneau, devis, facture) : ${lien}`,
  }
}

/* ─────────────── Résultat publié au locataire (après la validation du propriétaire) ─────────────── */

const _texte = (t) => { const b = (t && TEXTES[t.id]) || null; return b ? { ref: b.ref, extrait: b.extrait, url: b.url } : null }
/**
 * Résultat montré au locataire : payeur RETENU par le propriétaire, constat, travaux, montant si le locataire paie,
 * textes cités relus dans le référentiel (jamais ceux stockés). Zone grise non tranchée → { erreur }.
 */
export const EXCEPTIONS_LOCATAIRE = Object.freeze({
  // Loi n° 89-462, art. 7 c : « à moins qu'il ne prouve qu'elles ont eu lieu par cas de force majeure, par la faute du
  // bailleur ou par le fait d'un tiers qu'il n'a pas introduit dans le logement ».
  degradation: 'Si les dégradations viennent d\'un cas de force majeure, d\'une faute du bailleur ou du fait d\'un tiers non introduit dans le logement, le signaler au bailleur : elles ne seraient alors pas à la charge du locataire. Selon le contrat, l\'assurance habitation peut couvrir certains dommages.',
  // Art. 7 d : « sauf si elles sont occasionnées par vétusté, malfaçon, vice de construction, cas fortuit ou force majeure ».
  reparation: 'Si la cause est autre (vétusté, malfaçon, vice de construction, cas fortuit ou force majeure), le signaler au bailleur : la réparation lui reviendrait alors. Selon le contrat, l\'assurance habitation peut couvrir certains dommages.',
})
export function resultatPourLocataire({ verdict, payeurRetenu, constat, montantTtc, factureNumero, now } = {}) {
  if (!verdict) return { erreur: 'Aucun verdict : enregistrer d\'abord le constat.' }
  const p = payeurRetenu || verdict.payeur
  if (!p || p === PAYEURS.ARBITRER) return { erreur: 'Zone grise : choisir d\'abord une des deux lectures (payeur retenu).' }
  let textes = []
  if (p === verdict.payeur) textes = verdict.textes || []
  else { const l = (verdict.lectures || []).find((x) => x.payeur === p); textes = l ? l.textes || [] : [] }
  const m = montant(montantTtc)
  const c = constat || {}
  return {
    payeur: p,
    payeurLbl: PAYEUR_LBL[p] || p,
    montantTtc: p === PAYEURS.LOCATAIRE && m ? m : null,
    facture: p === PAYEURS.LOCATAIRE ? _s(factureNumero).slice(0, 60) : '',
    constat: constatLbl(c.constat), ampleur: ampleurLbl(c.ampleur), cause: causeAffichee((entreeMoteur(c) || {}).cause),
    travaux: _s(c.resume).slice(0, 1000),
    textes: textes.map(_texte).filter(Boolean),
    // Rappel des exceptions de LA règle appliquée : art. 7 c (dégradations) ou art. 7 d (réparations locatives).
    exceptions: p !== PAYEURS.LOCATAIRE ? null
      : (entreeMoteur(c) || {}).cause === 'faute_locataire' ? EXCEPTIONS_LOCATAIRE.degradation : EXCEPTIONS_LOCATAIRE.reparation,
    publieLe: now || new Date().toISOString(),
  }
}
