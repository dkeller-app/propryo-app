/**
 * core/incidents.js — REGISTRE DES INCIDENTS (chantier TRAVAUX : QUI PAIE ?).
 *
 * Helpers PURS autour d'un incident : création, statuts horodatés, contexte lu sur le bail et
 * l'immeuble, carnet d'artisans DÉRIVÉ des interventions passées, annuaire officiel des entreprises
 * et liste RGE (construction des requêtes + lecture des réponses, tri alphabétique : on LISTE, on ne
 * recommande pas), numéros d'assistance, items de la famille « Incidents à traiter ».
 *
 * Le verdict « qui paie » vit dans qui-paie.js. Aucun montant n'est calculé ici : la facture part dans
 * Finances par un mouvement (_mvCreate). Aucune dépendance DB / DOM / réseau (l'appelant fait le fetch).
 */

export const STATUTS = Object.freeze([
  { k: 'signale', lbl: 'Signalé' }, { k: 'en_cours', lbl: 'En cours' }, { k: 'resolu', lbl: 'Résolu' },
]);
export const statutLbl = (k) => (STATUTS.find((s) => s.k === k) || STATUTS[0]).lbl;

export const SIGNALE_PAR = Object.freeze([
  { k: 'locataire', lbl: 'Locataire' }, { k: 'bailleur', lbl: 'Bailleur' }, { k: 'syndic', lbl: 'Syndic' }, { k: 'autre', lbl: 'Autre' },
]);
export const CANAUX = Object.freeze([
  { k: 'telephone', lbl: 'Par téléphone' }, { k: 'sms', lbl: 'Par SMS' }, { k: 'email', lbl: 'Par e-mail' }, { k: 'visite', lbl: 'Sur place' },
  { k: 'espace', lbl: 'Par l\'espace locataire' }, { k: 'autre', lbl: 'Autre' },
]);

const _s = (v) => (v == null ? '' : String(v));
/** Jour LOCAL (AAAA-MM-JJ) d'un horodatage ISO — `slice(0,10)` donnerait la veille entre 0 h et 2 h en France. */
export function jourLocal(iso) {
  const s = _s(iso); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s); if (isNaN(d.getTime())) return s.slice(0, 10)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const _norm = (v) => _s(v).trim().toLowerCase();

/**
 * Nouvel incident (forme stockée dans DB.incidents). `now` = ISO. Champs inconnus ignorés.
 * Rattachements : logRef (logement) OU imm (immeuble, partie commune), entity (SCI).
 */
export function nouvelIncident(f, now) {
  const x = f || {};
  const t = now || new Date().toISOString();
  return {
    id: x.id,
    logRef: _s(x.logRef),
    imm: _s(x.imm),
    entity: _s(x.entity),
    creeLe: x.creeLe || t,
    signalePar: x.signalePar || 'locataire',
    signaleParNom: _s(x.signaleParNom),
    canal: x.canal || 'telephone',
    element: x.element || 'autre',
    elementLibre: _s(x.elementLibre),
    nature: x.nature || 'autre',
    intervention: x.intervention || 'inconnue',
    cause: x.cause || 'inconnue',
    urgences: Array.isArray(x.urgences) ? x.urgences.slice() : [],
    ageAns: (x.ageAns === '' || x.ageAns == null || isNaN(Number(x.ageAns))) ? null : Number(x.ageAns),
    description: _s(x.description),
    contexte: Object.assign({ meuble: null, partieCommune: false, copro: null, clauseChaudiereBailleur: false }, x.contexte || {}),
    statut: 'signale',
    statutDates: { signale: x.creeLe || t },
    verdict: null,
    payeurRetenu: null,
    artisan: null,
    assurance: { checklist: {} },
    mouvementIds: [],
    ia: null,            // point d'accroche du tri des photos par IA (chantier socle IA) — toujours null ici
  };
}

/** Change le statut et horodate le passage (le passage à « résolu » garde les dates précédentes). */
export function changerStatut(inc, statut, now) {
  if (!inc || !STATUTS.some((s) => s.k === statut)) return inc;
  inc.statut = statut;
  inc.statutDates = Object.assign({}, inc.statutDates || {});
  if (!inc.statutDates[statut]) inc.statutDates[statut] = now || new Date().toISOString();
  return inc;
}

/** Vivant + trié du plus récent au plus ancien. */
export function incidentsDe(incidents, { logRef = null, imm = null } = {}) {
  return (Array.isArray(incidents) ? incidents : [])
    .filter((i) => i && !i._deleted)
    .filter((i) => (logRef != null ? _norm(i.logRef) === _norm(logRef) : true))
    .filter((i) => (imm != null ? (!i.logRef && _norm(i.imm) === _norm(imm)) : true))
    .sort((a, b) => _s(b.creeLe).localeCompare(_s(a.creeLe)));
}
export const estOuvert = (i) => !!i && !i._deleted && i.statut !== 'resolu';

/**
 * Contexte du verdict, lu sur le bail actif et l'immeuble.
 * @param {{bail?:object, imm?:object}} src
 */
export function contexteDe({ bail = null, imm = null } = {}) {
  const t = bail && bail.type;
  const meuble = bail ? ['meuble', 'etudiant', 'mobilite'].includes(t) : null;
  const r = (imm && imm.regimeJuridique) || (bail && bail.regimeJuridique);   // repli : régime porté par le bail
  const copro = r === 'Copropriété' ? true : (r === 'Monopropriété' ? false : null);
  return { meuble, copro, partieCommune: false, clauseChaudiereBailleur: false };
}

/* ─────────────── Qui appeler ─────────────── */

/** Métier → code d'activité (NAF rév. 2) de l'annuaire officiel. `q` = mot-clé quand le code seul est trop large. */
export const NAF_METIERS = Object.freeze({
  plomberie: { lbl: 'Plomberie', naf: '43.22A' },
  chauffage: { lbl: 'Chauffage, climatisation', naf: '43.22B' },
  electricite: { lbl: 'Électricité', naf: '43.21A' },
  serrurerie: { lbl: 'Serrurerie', naf: '43.32B' },
  menuiserie: { lbl: 'Menuiserie', naf: '43.32A' },
  vitrerie: { lbl: 'Vitrerie, peinture', naf: '43.34Z' },
  peinture: { lbl: 'Peinture', naf: '43.34Z' },
  sol: { lbl: 'Revêtements de sol', naf: '43.33Z' },
  couverture: { lbl: 'Couverture, toiture', naf: '43.91B' },
  maconnerie: { lbl: 'Maçonnerie', naf: '43.99C' },
  electromenager: { lbl: 'Réparation d\'électroménager', naf: '95.22Z' },
  ramonage: { lbl: 'Ramonage', naf: '81.22Z', q: 'ramonage' },
  nuisibles: { lbl: 'Désinsectisation, dératisation', naf: '81.29A' },
  assainissement: { lbl: 'Vidange, assainissement', naf: '37.00Z' },
  jardin: { lbl: 'Entretien de jardins', naf: '81.30Z' },
});
/** Domaines où la liste RGE a un sens (travaux énergétiques). */
export const METIERS_RGE = Object.freeze(['chauffage', 'menuiserie', 'couverture', 'plomberie']);

export const ANNUAIRE_BASE = 'https://recherche-entreprises.api.gouv.fr/search';
export const RGE_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines';

const _cp = (cp) => { const s = _s(cp).replace(/\s/g, ''); return /^\d{5}$/.test(s) ? s : null; };

/** URL de recherche dans l'annuaire officiel. Seuls le code d'activité, le code postal (et un mot-clé) partent. */
export function annuaireUrl({ metier, codePostal, page = 1 } = {}) {
  const m = NAF_METIERS[metier]; const cp = _cp(codePostal);
  if (!m || !cp) return null;
  const p = new URLSearchParams({ activite_principale: m.naf, code_postal: cp, etat_administratif: 'A', per_page: '25', page: String(page) });
  if (m.q) p.set('q', m.q);
  return ANNUAIRE_BASE + '?' + p.toString();
}

/**
 * Lit la réponse de l'annuaire : établissements ACTIFS du code postal demandé (pas le siège ailleurs),
 * dédoublonnés par SIRET, triés par ordre ALPHABÉTIQUE (aucun classement).
 */
export function lireAnnuaire(json, codePostal) {
  const cp = _cp(codePostal);
  const out = new Map();
  ((json && json.results) || []).forEach((r) => {
    const etabs = [].concat(r.matching_etablissements || [], r.siege ? [r.siege] : []);
    etabs.forEach((e) => {
      if (!e || e.etat_administratif !== 'A') return;
      if (cp && _s(e.code_postal) !== cp) return;
      const siret = _s(e.siret);
      if (!siret || out.has(siret)) return;
      out.set(siret, {
        nom: _s(r.nom_complet || r.nom_raison_sociale).trim(),
        siret,
        adresse: _s(e.adresse).trim(),
        commune: _s(e.libelle_commune).trim(),
        rge: Array.isArray(e.liste_rge) && e.liste_rge.length > 0,
        ficheUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/' + siret,
      });
    });
  });
  return [...out.values()].filter((x) => x.nom).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** URL de la liste RGE (ADEME) pour un code postal. */
export function rgeUrl({ codePostal } = {}) {
  const cp = _cp(codePostal); if (!cp) return null;
  const p = new URLSearchParams({ size: '100', qs: 'code_postal:' + cp, select: 'nom_entreprise,siret,adresse,commune,code_postal,domaine,lien_date_fin,telephone,nom_certificat' });
  return RGE_BASE + '?' + p.toString();
}

/** Lit la liste RGE : qualification EN COURS de validité, une ligne par entreprise (domaines regroupés), ordre alphabétique. */
export function lireRge(json, aujourdhui) {
  const today = _s(aujourdhui).slice(0, 10);
  const out = new Map();
  ((json && json.results) || []).forEach((r) => {
    if (!r || !r.siret || !r.nom_entreprise) return;
    if (today && r.lien_date_fin && _s(r.lien_date_fin).slice(0, 10) < today) return;
    const k = _s(r.siret);
    const cur = out.get(k) || { nom: _s(r.nom_entreprise).trim(), siret: k, adresse: _s(r.adresse).trim(), commune: _s(r.commune).trim(), tel: _s(r.telephone).trim(), domaines: [], ficheUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/' + k };
    if (r.domaine && !cur.domaines.includes(r.domaine)) cur.domaines.push(r.domaine);
    out.set(k, cur);
  });
  return [...out.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * Carnet d'artisans DÉRIVÉ (pas de table) : artisans des incidents passés + intervenants des
 * entretiens d'équipement. Dédoublonné (SIRET, sinon nom normalisé), le plus récent d'abord.
 * @param {Array} incidents DB.incidents
 * @param {object} equipements DB.equipements ({ [ref]: { [rule]: { lastDate, interv } } })
 */
export function carnetArtisans(incidents, equipements, { metier = null } = {}) {
  const out = new Map();
  const add = (a, src) => {
    const nom = _s(a.nom).trim(); if (!nom) return;
    const k = _s(a.siret).replace(/\s/g, '') || ('n:' + _norm(nom));
    const prev = out.get(k);
    if (prev && _s(prev.date) >= _s(src.date)) return;
    out.set(k, { nom, siret: _s(a.siret).replace(/\s/g, ''), tel: _s(a.tel).trim(), metier: a.metier || null, date: _s(src.date).slice(0, 10), contexte: src.contexte, logRef: src.logRef || '' });
  };
  (Array.isArray(incidents) ? incidents : []).forEach((i) => {
    if (!i || i._deleted || !i.artisan || !i.artisan.nom) return;
    add(i.artisan, { date: (i.statutDates && (i.statutDates.resolu || i.statutDates.en_cours)) || i.creeLe, contexte: i.elementLibre || i.element, logRef: i.logRef });
  });
  Object.entries(equipements || {}).forEach(([ref, rules]) => {
    Object.entries(rules || {}).forEach(([rule, d]) => {
      if (d && d.interv && String(d.interv).trim()) add({ nom: d.interv }, { date: d.lastDate || '', contexte: 'Entretien ' + rule, logRef: ref });
    });
  });
  return [...out.values()]
    .filter((a) => !metier || !a.metier || a.metier === metier)
    .sort((a, b) => _s(b.date).localeCompare(_s(a.date)));
}

/** Numéros d'assistance : MRH du locataire (DB.mrh) et PNO du bailleur (DB.assurances), pour un logement. */
export function assistances({ mrh = [], assurances = [], logRef = '', imm = '' } = {}) {
  const vivant = (x) => x && !x._deleted;
  const m = (mrh || []).filter((x) => vivant(x) && _norm(x.logement) === _norm(logRef)).sort((a, b) => _s(b.echeance).localeCompare(_s(a.echeance)))[0] || null;
  const p = (assurances || []).filter((x) => vivant(x) && _s(x.type || 'PNO').toUpperCase() === 'PNO'
    && ((x.portee === 'logement' && _norm(x.logement) === _norm(logRef)) || (x.portee === 'immeuble' && _norm(x.immeuble) === _norm(imm))))
    .sort((a, b) => (a.portee === 'logement' ? -1 : 1) - (b.portee === 'logement' ? -1 : 1))[0] || null;
  const fiche = (x, kind) => (x ? { kind, id: x.id, compagnie: _s(x.compagnie), numContrat: _s(x.numContrat), tel: _s(x.telAssistance).trim() } : { kind, id: null, compagnie: '', numContrat: '', tel: '' });
  return { mrh: fiche(m, 'mrh'), pno: fiche(p, 'pno') };
}

/* ─────────────── Famille « Incidents à traiter » ─────────────── */

const _jours = (a, b) => Math.floor((Date.parse(_s(b).slice(0, 10)) - Date.parse(_s(a).slice(0, 10))) / 86400000);

/**
 * Items de la famille (incidents NON résolus), au format de pilotage-familles :
 * { ref, nom, urgenceJours (ancienneté, grand = urgent), urgent, incId }.
 * Les urgences passent devant : leur ancienneté est majorée de 10 000 jours (tri seulement).
 */
export function itemsIncidents(incidents, aujourdhui, libelle) {
  const lbl = typeof libelle === 'function' ? libelle : (i) => i.elementLibre || i.element;
  return (Array.isArray(incidents) ? incidents : []).filter(estOuvert).map((i) => {
    const age = Math.max(0, _jours(jourLocal(i.creeLe), aujourdhui) || 0);
    const urgent = Array.isArray(i.urgences) && i.urgences.length > 0;
    return { ref: i.logRef || i.imm || '', nom: lbl(i), urgenceJours: age + (urgent ? 10000 : 0), age, urgent, incId: i.id };
  });
}
/** Chiffre de gravité de la bulle : « 1 urgent », « 2 urgents », sinon « depuis 12 jours ». */
export function chiffreIncidents(items) {
  const l = Array.isArray(items) ? items : [];
  const u = l.filter((x) => x.urgent).length;
  if (u) return u + ' urgent' + (u > 1 ? 's' : '');
  const max = l.reduce((m, x) => Math.max(m, x.age || 0), 0);
  return max <= 0 ? 'signalé aujourd\'hui' : 'depuis ' + max + ' jour' + (max > 1 ? 's' : '');
}

/* ─────────────── La facture part dans Finances (lot e) ─────────────── */

/**
 * Le mouvement d'une facture payée par le bailleur, à la forme exacte d'un mouvement saisi à la main
 * (saveMv) : { date, lib, imm, cat, qui, db, cr, fac, compteurCcId } + `incidentId` (lien retour).
 * `id` et l'horodatage sont posés par l'appelant (_mvCreate). Aucun calcul : le montant est celui saisi.
 * @returns {{ok:true, mv:object}|{ok:false, erreur:string}}
 */
export function mouvementFacture({ inc, montant, date, numero = '', categorie, libelleElement = '', immDuLogement = '' } = {}) {
  const m = Math.round(Number(String(montant == null ? '' : montant).replace(/\s/g, '').replace(',', '.')) * 100) / 100;
  if (!inc) return { ok: false, erreur: 'Incident introuvable.' }
  if (!(m > 0)) return { ok: false, erreur: 'Indiquer le montant payé.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(_s(date))) return { ok: false, erreur: 'Indiquer la date du paiement.' }
  if (!categorie) return { ok: false, erreur: 'Choisir la nature de la dépense.' }
  const lib = 'Travaux — ' + (_s(libelleElement).trim() || 'incident') + (inc.logRef ? ' (' + inc.logRef + ')' : (inc.imm ? ' (parties communes)' : ''))
  return { ok: true, mv: {
    date: _s(date), lib,
    imm: inc.logRef ? _s(immDuLogement) : _s(inc.imm),
    cat: categorie,
    qui: _s(inc.logRef),
    db: m, cr: 0,
    fac: _s(numero).trim(),
    compteurCcId: '',
    incidentId: inc.id,
  } }
}

/**
 * Mouvements DÉJÀ présents (import bancaire, saisie) qui peuvent être la facture de cet incident :
 * même logement (ou même immeuble pour une partie commune), au débit, non rattachés à un autre incident,
 * datés de 30 jours avant le signalement à 180 jours après. Le plus proche du signalement d'abord.
 * Rattacher plutôt que recréer : une dépense n'est comptée qu'UNE fois (Finances, 2044).
 */
export function mouvementsRattachables(mouvements, inc, { espaceId } = {}) {
  if (!inc) return []
  const t0 = Date.parse(jourLocal(inc.creeLe))
  // Même ESPACE (deux SCI partagées peuvent avoir un logement homonyme) : `espaceId` = espace de
  // l'incident (null = espace propre) ; non fourni → pas de filtre (appelant mono-espace, tests).
  const memeEspace = (m) => espaceId === undefined || ((m._espaceId == null ? null : String(m._espaceId)) === (espaceId == null ? null : String(espaceId)))
  return (Array.isArray(mouvements) ? mouvements : []).filter((m) => {
    if (!m || m._deleted || !(+m.db > 0) || m.compteurCcId) return false
    if (!memeEspace(m)) return false
    if (m.incidentId != null && String(m.incidentId) !== String(inc.id)) return false
    if (inc.logRef ? _norm(m.qui) !== _norm(inc.logRef) : !(!m.qui && _norm(m.imm) === _norm(inc.imm))) return false
    const d = Date.parse(_s(m.date).slice(0, 10)); if (!isFinite(d) || !isFinite(t0)) return false
    const j = (d - t0) / 86400000
    return j >= -30 && j <= 180
  }).sort((a, b) => Math.abs(Date.parse(a.date) - t0) - Math.abs(Date.parse(b.date) - t0))
}
