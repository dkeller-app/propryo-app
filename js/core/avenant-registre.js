/**
 * core/avenant-registre.js — AVENANT-REFONTE lot 2 (29/09) : registre des avenants d'un bail.
 *
 * Décision A (Didier 28/09) : un avenant vit À CÔTÉ du bail, jamais dans la ligne du bail (verrouillée
 * au cloud une fois signée). Il est une entrée du journal `DB.baux_evenements` (table cloud
 * `baux_evenements`, type 'avenant' autorisé par la migration 0054, RLS par entité du bail) :
 *   { id, type:'avenant', ref (clé nue du logement), bailDebut, _espaceId?, bailUid?, signedAt?,
 *     no, statut, date (= date d'effet), ville, objets:[{k,data}], html (document figé),
 *     appliques:[libellés], docSeul:[libellés], createdAt, statutLe, signeLe?, signeMode?, _modifiedAt }
 *
 * Avant ce lot, un avenant était écrit dans `bail.avenants[]` (+ un événement 'avenant' de
 * `DB.bailEvents` depuis v15.681). Ces avenants ne sont PAS recopiés au chargement (deux appareils
 * créeraient la même ligne en même temps) : ils sont lus tels quels et affichés comme les autres
 * (`virtuel:true`). Au premier geste qui change leur statut, l'app écrit leur entrée de registre (même
 * `id` déterministe) — qui prend alors le pas sur l'ancienne trace.
 *
 * Statuts (§9) : Brouillon (rien appliqué, modifiable, supprimable) → À signer (enregistré, figé) →
 * Signé · Annulé (conservé, barré ; possible seulement tant que rien n'a été appliqué au bail).
 *
 * Module PUR : aucune lecture de DB ni de l'horloge (dates injectées).
 */

import { avenantMontant, avenantObjetApplique, regimeForfaitObjet } from './avenant.js';

export const STATUTS = {
  brouillon: { l: 'Brouillon', ton: 'mute' },
  a_signer: { l: 'À signer', ton: 'warn' },
  signe: { l: 'Signé', ton: 'ok' },
  annule: { l: 'Annulé', ton: 'mute' },
};

// Transitions permises. « Signé » et « Annulé » sont définitifs : on revient sur un avenant signé
// par un NOUVEL avenant, jamais en le modifiant.
const TRANSITIONS = {
  brouillon: ['a_signer'],
  a_signer: ['signe', 'annule'],
  signe: [],
  annule: [],
};

const _ymd = (s) => String(s == null ? '' : s).slice(0, 10);
export const cleNue = (k) => String(k == null ? '' : k).split('@@')[0];

/** Vrai si l'entrée `e` (registre ou trace ancienne) concerne CE bail : même logement, même bail
 *  (date de début — un logement garde la même clé au fil des baux), même espace si l'entrée en porte un. */
function _memeBail(e, cle, bail, { strictEspace, debutsClos }) {
  if (!e || e._deleted || e.type !== 'avenant') return false;
  // Registre : clé nue + espace strict. Trace ancienne (DB.bailEvents, non taguée) : réf COMPLÈTE, comme
  // l'ancien avenantNumeroSuivant — la clé nue confondrait deux espaces qui ont le même logement.
  if (strictEspace ? cleNue(e.ref) !== cleNue(cle) : String(e.ref == null ? '' : e.ref) !== String(cle == null ? '' : cle)) return false;
  const esp = (bail && bail._espaceId) || null;
  const eEsp = e._espaceId == null ? null : e._espaceId;
  if (strictEspace ? eEsp !== esp : (eEsp != null && eEsp !== esp)) return false;
  const debut = _ymd(bail && bail.debut);
  const eDebut = _ymd(e.bailDebut);
  // Avenant d'un bail CLOS du même logement (son `bailDebut` = le début de ce bail clos) : il appartient
  // à ce bail, jamais au suivant — même daté après le début du bail courant (effet au lendemain de la
  // clôture, avenant resté « À signer »). Sans cette règle, un passage au forfait d'un bail meublé clos
  // excluait de la régul les charges d'un nouveau bail nu (audit 30/09).
  if (eDebut && eDebut !== debut && Array.isArray(debutsClos) && debutsClos.some((d) => _ymd(d) === eDebut)) return false;
  // Même début de bail, ou daté à partir du début du bail (date de début corrigée après coup, trace
  // ancienne sans bailDebut). Un avenant du bail PRÉCÉDENT est daté avant le début du bail courant.
  return _ymd(e.bailDebut) === debut || (!!debut && _ymd(e.date) >= debut);
}

/** Rattachement d'une entrée à son bail : espace (routage, partage SCI), ligne cloud (`bailUid`),
 *  signature (`signedAt`, lu par store-sync). Commun aux entrées neuves et aux avenants anciens repris :
 *  sans lui, une entrée reprise sur un bail tagué d'un espace ne serait jamais retrouvée (audit C1). */
function _rattachement(b) {
  const r = {};
  if (b && b._espaceId != null) r._espaceId = b._espaceId;
  if (b && b._bailUid) r.bailUid = b._bailUid;
  if (b && b.signatures && b.signatures.signedAt) r.signedAt = b.signatures.signedAt;
  return r;
}

/** Entrées de REGISTRE du bail (hors supprimées), triées par numéro croissant. */
export function avenantsDuBail(journal, cle, bail, debutsClos) {
  return (Array.isArray(journal) ? journal : [])
    .filter((e) => _memeBail(e, cle, bail, { strictEspace: true, debutsClos }))
    .sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
}

/** Identifiant déterministe d'un avenant ancien (même valeur sur tous les appareils). */
export function idAvenantRepris(cle, bail, no) {
  return 'av_rep_' + cleNue(cle) + '_' + _ymd(bail && bail.debut) + '_' + (Number(no) || 0);
}

// Avant v15.681 (et encore depuis, pour loyer / charges), un avenant appliquait loyer et charges DÈS
// l'enregistrement. Sans trace de ce qui a été appliqué, on considère appliqué ce qui pouvait l'être.
function _appliquesDeduits(objets) {
  const ks = (objets || []).map((o) => (o && typeof o === 'object' ? o.k : o));
  const out = [];
  if (ks.includes('loyer')) out.push('Loyer');
  if (ks.includes('charges')) out.push('Charges');
  return out;
}

/**
 * Tous les avenants du bail, pour l'affichage : registre + avenants anciens non encore repris
 * (`virtuel:true`, statut « À signer » : l'app n'a jamais su s'ils avaient été signés).
 * Ordre : numéro décroissant (le plus récent en tête).
 */
export function listeAvenants({ journal, bailEvents, cle, bail, debutsClos } = {}) {
  const b = bail || {};
  const reg = avenantsDuBail(journal, cle, b, debutsClos);
  const pris = new Set(reg.map((e) => Number(e.no) || 0));
  const anciens = new Map();   // no → avenant reconstitué
  for (const a of (Array.isArray(b.avenants) ? b.avenants : [])) {
    const no = Number(a && a.no) || 0;
    if (!no || pris.has(no)) continue;
    const objets = Array.isArray(a.objets) ? a.objets : [];
    anciens.set(no, {
      id: idAvenantRepris(cle, b, no), type: 'avenant', virtuel: true, ref: cleNue(cle), bailDebut: _ymd(b.debut),
      no, statut: 'a_signer', date: _ymd(a.dateEffet), ville: a.ville || '', objets, html: typeof a.html === 'string' ? a.html : null,
      createdAt: a.createdAt || null, appliques: _appliquesDeduits(objets), docSeul: null, ..._rattachement(b),
    });
  }
  for (const e of (Array.isArray(bailEvents) ? bailEvents : [])) {
    if (!_memeBail(e, cle, b, { strictEspace: false, debutsClos })) continue;
    const no = Number(e.no) || 0;
    if (!no || pris.has(no)) continue;
    const prev = anciens.get(no);
    const appliques = Array.isArray(e.appliques) ? e.appliques.slice() : null;
    if (prev) {
      // Même avenant vu des deux côtés : l'événement dit ce qui a VRAIMENT été appliqué.
      if (appliques) prev.appliques = appliques;
      if (Array.isArray(e.docSeul)) prev.docSeul = e.docSeul.slice();
      if (!prev.date) prev.date = _ymd(e.date);
      continue;
    }
    const objets = (Array.isArray(e.objets) ? e.objets : []).map((k) => ({ k }));
    anciens.set(no, {
      id: idAvenantRepris(cle, b, no), type: 'avenant', virtuel: true, ref: cleNue(cle), bailDebut: _ymd(b.debut),
      no, statut: 'a_signer', date: _ymd(e.date), ville: '', objets, html: null, createdAt: null,
      appliques: appliques || _appliquesDeduits(objets), docSeul: Array.isArray(e.docSeul) ? e.docSeul.slice() : null,
      ..._rattachement(b),
    });
  }
  return reg.concat([...anciens.values()]).sort((a, b2) => (Number(b2.no) || 0) - (Number(a.no) || 0));
}

/** Numéro du prochain avenant : max des numéros connus (registre, brouillons compris, et anciens) + 1. */
export function numeroSuivant(args) {
  let max = 0;
  for (const a of listeAvenants(args)) max = Math.max(max, Number(a.no) || 0);
  return max + 1;
}

/** Nouvelle entrée de registre. `now` : ISO injecté. */
export function nouvelAvenant({ id, cle, bail, no, statut, date, ville, objets, html, appliques, docSeul, now } = {}) {
  const b = bail || {};
  if (!STATUTS[statut] || statut === 'signe' || statut === 'annule') throw new Error('nouvelAvenant : statut initial invalide ' + statut);
  const e = {
    id, type: 'avenant', ref: cleNue(cle), bailDebut: _ymd(b.debut), no: Number(no) || 1, statut,
    date: _ymd(date), ville: ville || '', objets: JSON.parse(JSON.stringify(objets || [])), html: html || null,
    appliques: (appliques || []).slice(), docSeul: (docSeul || []).slice(),
    createdAt: now, statutLe: now, _modifiedAt: now,
  };
  // Rattachement à la ligne cloud du bail (store-sync `_rattacherJournal` le recale avant le 1er envoi).
  return Object.assign(e, _rattachement(b));
}

/** Peut-on passer de `av.statut` à `statut` ? Annuler exige que rien n'ait été appliqué au bail. */
const _own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Libellé / ton d'un statut (statut inconnu ou malformé → « À signer », jamais d'exception). */
export function statutDe(av) { return (av && typeof av.statut === 'string' && _own(STATUTS, av.statut)) ? STATUTS[av.statut] : STATUTS.a_signer; }
export function transitionPermise(av, statut) {
  if (!av || typeof av.statut !== 'string' || !_own(TRANSITIONS, av.statut) || !TRANSITIONS[av.statut].includes(statut)) return false;
  if (statut === 'annule' && Array.isArray(av.appliques) && av.appliques.length) return false;
  return true;
}

/**
 * Copie de l'avenant au nouveau statut (null si la transition est interdite). Un avenant ancien
 * (`virtuel`) devient une vraie entrée de registre : on retire le marqueur.
 * `extra` : { signeLe, signeMode } pour « Signé ».
 */
export function avecStatut(av, statut, now, extra) {
  if (!transitionPermise(av, statut)) return null;
  const e = JSON.parse(JSON.stringify(av));
  delete e.virtuel;
  e.statut = statut; e.statutLe = now; e._modifiedAt = now;
  if (!e.createdAt) e.createdAt = now;
  if (statut === 'signe') {
    e.signeLe = _ymd((extra && extra.signeLe) || now);
    e.signeMode = (extra && extra.signeMode) || 'papier';
    // Pièces de la signature (lot 3b) : scan déposé ou déclaré détenu, PDF signé et certificat au cloud,
    // empreinte et preuve par signataire. Liste FERMÉE : rien d'autre n'entre par cette porte.
    for (const k of PIECES_SIGNATURE) if (extra && extra[k] != null) e[k] = JSON.parse(JSON.stringify(extra[k]));
  }
  return e;
}
export const PIECES_SIGNATURE = ['scanDocId', 'scanDetenu', 'pdfDocId', 'pdfKey', 'contentHash', 'proof'];

/** Gestes proposés sur une carte (l'écran n'affiche que ceux-là). */
export function actionsAvenant(av) {
  if (!av) return [];
  const a = [];
  if (av.statut === 'brouillon') return ['reprendre', 'supprimer'];
  // PDF SIGNÉ (pièce jointe du bail, ou clé cloud) quand il existe ; sinon le document enregistré, non signé.
  if (av.html) a.push('voir', (av.pdfDocId || av.pdfKey) ? 'pdf-signe' : 'pdf');
  if (av.scanDocId) a.push('scan');
  else if (av.statut === 'signe' && av.signeMode === 'papier') a.push('deposer-scan');   // déposer plus tard, jamais imposé
  if (transitionPermise(av, 'signe')) { if (av.html) a.push('signe-appareil'); a.push('signe-papier'); }
  if (transitionPermise(av, 'annule')) a.push('annuler');
  return a;
}

const _eur = (v) => {
  const s = String(v == null ? '' : v).trim();
  const n = Number(s.replace(',', '.'));
  return s !== '' && Number.isFinite(n) ? n.toFixed(2).replace('.', ',') + ' €' : '';
};

/** Titre court d'un objet (« Départ de Bruno Leroy », « Charges 95,00 € »…). Texte brut. */
function _titreObjet(o, libelles) {
  const k = o && o.k; const d = (o && o.data) || {};
  const lbl = (libelles && libelles[k]) || k || '';
  if (k === 'coloc') {
    const act = String(d.act || '');
    if (/^Départ/.test(act) && d.sortant) return 'Départ de ' + d.sortant;
    if (/^Ajout/.test(act) && d.entrant) return 'Arrivée de ' + d.entrant;
    if (/^Remplacement/.test(act) && (d.sortant || d.entrant)) return 'Remplacement de ' + (d.sortant || '?') + ' par ' + (d.entrant || '?');
    return lbl;
  }
  if (k === 'caution') {
    const act = String(d.act || '');
    const nom = String(d.nom || '').trim();
    if (/^Mainlevée/.test(act)) return nom ? 'Mainlevée de la caution ' + nom : 'Mainlevée de caution';
    if (/^Remplacement/.test(act)) return nom ? 'Nouvelle caution : ' + nom : 'Remplacement de caution';
    return nom ? 'Caution : ' + nom : lbl;
  }
  if (k === 'loyer') { const m = _eur(d.nouveau); return m ? 'Loyer ' + m + ' HC' : lbl; }
  if (k === 'charges') { const m = _eur(d.montant); return m ? 'Charges ' + m : lbl; }
  return lbl;
}

/** « Avenant n° 2 — Départ de Bruno Leroy · Charges 95,00 € ». Texte brut (à échapper). */
export function titreAvenant(av, libelles) {
  const objs = (av && Array.isArray(av.objets) ? av.objets : []).map((o) => _titreObjet(typeof o === 'object' ? o : { k: o }, libelles)).filter(Boolean);
  return 'Avenant n° ' + ((av && av.no) || '?') + (objs.length ? ' — ' + objs.join(' · ') : '');
}

/**
 * Débuts des baux CLOS du logement (`DB.baux_historique`), à passer en `debutsClos` à listeAvenants /
 * numeroSuivant : un avenant rattaché à l'un d'eux n'est jamais attribué au bail courant. Même espace
 * quand l'archive en porte un (partage SCI) ; le début du bail courant lui-même n'est jamais renvoyé.
 */
export function debutsBauxClos(historique, cle, bail) {
  const esp = (bail && bail._espaceId) || null;
  const debut = _ymd(bail && bail.debut);
  const out = [];
  for (const h of (Array.isArray(historique) ? historique : [])) {
    if (!h || h._deleted || cleNue(h.ref) !== cleNue(cle)) continue;
    if (h._espaceId != null && h._espaceId !== esp) continue;
    const d = _ymd(h.debut);
    if (d && d !== debut && !out.includes(d)) out.push(d);
  }
  return out;
}

// ── LOT 3 — APPLICATION À LA SIGNATURE (décision B, CDC §1 B / §5) ─────────────────────────────────
// Un avenant enregistré à partir du lot 3 porte `aLaSignature:true` : rien ne change dans le bail avant
// qu'il soit signé par toutes les parties ; ses changements sont alors datés à sa date d'effet. Les
// avenants antérieurs (lot 2 / v15.681) ont déjà appliqué loyer et charges à l'enregistrement : on ne
// les réapplique jamais (`appliques` le dit).

// Valeurs du formulaire d'avenant → valeurs du bail (`destinationLocaux` : 'habitation' | 'mixte').
const _DESTINATION = { "usage exclusif d'habitation": 'habitation', 'usage mixte (habitation et activité professionnelle)': 'mixte' };
const _isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(String(s) + 'T00:00:00Z'));

/**
 * Ce que la signature de l'avenant change dans le bail — PUR, rien n'est écrit.
 * @param {{objets:Array, bail:Object, libelles?:Object, forfaitAvant?:boolean}} p
 *   forfaitAvant : régime de charges EN VIGUEUR à la date d'effet sans cet avenant (timeline des avenants,
 *   `bailForfaitActifLe`) ; absent → flag du bail (`chForfait`, non daté).
 * @returns {{hc:number|null, ch:number|null, regime:boolean, champs:Array<{champ,apres}>, appliques:string[], docSeul:string[], alertes:string[]}}
 *   hc / ch : nouveaux montants à dater au barème (null = inchangé) ; regime : le régime des charges change
 *   (forfait ↔ provisions, lu par la régularisation à la date d'effet) ; champs : autres champs du bail.
 */
export function planApplication({ objets, bail, libelles, forfaitAvant } = {}) {
  const b = bail || {};
  const L = (k) => (libelles && libelles[k]) || k;
  const hc0 = Number(b.hc) || 0, ch0 = Number(b.ch) || 0;
  let hc = hc0, ch = ch0;
  const champs = [], appliques = [], docSeul = [], alertes = [];
  let regime = false;
  // Libellés qui dépendent du LOYER FINAL (loyer, supplément d'annexe) : décidés après le contrôle « loyer ≤ 0 ».
  const surLoyer = [];
  // Vrai seulement si le champ CHANGE réellement (valeur absente = valeur par défaut du formulaire du bail) :
  // un champ identique n'est ni journalisé ni annoncé « appliqué » (audit lot 3a, M2).
  const DEFAUTS = { destinationLocaux: 'habitation' };
  const pose = (champ, apres) => {
    const avant = (b[champ] == null || b[champ] === '') && _own(DEFAUTS, champ) ? DEFAUTS[champ] : b[champ];
    if (String(avant == null ? '' : avant) === String(apres)) return false;
    champs.push({ champ, apres }); return true;
  };
  for (const o of (Array.isArray(objets) ? objets : [])) {
    const k = o && o.k; const d = (o && o.data) || {};
    if (k === 'loyer') {
      const m = avenantMontant(d.nouveau, hc0, { strictPositif: true });
      if (!m.ok) { alertes.push('Nouveau loyer illisible : non appliqué.'); docSeul.push(L(k)); }
      else if (m.v !== hc0) { hc += m.v - hc0; surLoyer.push(L(k)); }
      else docSeul.push(L(k));
    } else if (k === 'charges') {
      const m = avenantMontant(d.montant, ch0);
      if (!m.ok) alertes.push('Montant des charges illisible : non appliqué.');
      else if (m.v !== ch0) ch = m.v;
      // Forfait de charges (art. 25-10 / 8-1, V) : le régime est DATÉ par l'avenant et lu par la régularisation
      // (bailForfaitActifLe) — un changement de régime est donc « appliqué », comme un montant.
      const forfait = regimeForfaitObjet(o);
      const avant = typeof forfaitAvant === 'boolean' ? forfaitAvant : !!b.chForfait;
      const change = forfait !== null && forfait !== avant;
      if (change) regime = true;
      const montantApplique = m.ok && m.v !== ch0;
      if (montantApplique) appliques.push(L(k));
      if (change) appliques.push(forfait ? 'Passage au forfait de charges' : 'Retour aux provisions');
      if (!avenantObjetApplique(o, { prevCh: ch0, newCh: montantApplique ? m.v : ch0, prevForfait: avant, newForfait: forfait === null ? avant : forfait })) docSeul.push(L(k));
      // Flag courant du bail (non daté) tenu aligné sur le dernier régime signé.
      if (forfait !== null && !!b.chForfait !== forfait) champs.push({ champ: 'chForfait', apres: forfait });
    } else if (k === 'annexe') {
      // Supplément de loyer d'une dépendance ajoutée (ou retirée) : porté par le loyer, daté au barème.
      const sup = avenantMontant(d.sup, 0);
      if (!sup.ok) { alertes.push('Loyer supplémentaire de l\'annexe illisible : non appliqué.'); docSeul.push(L(k)); }
      else if (sup.v > 0) { hc += /^Retrait/.test(String(d.act || '')) ? -sup.v : sup.v; surLoyer.push(L(k) + ' (loyer supplémentaire)'); }
      else docSeul.push(L(k));
    } else if (k === 'duree') {
      if (!_isoDate(d.fin)) { alertes.push('Nouveau terme du bail absent : non appliqué.'); docSeul.push(L(k)); }
      else (pose('fin', d.fin) ? appliques : docSeul).push(L(k));
    } else if (k === 'paiement') {
      // Seul le JOUR est une donnée du bail (1 à 28, comme le formulaire du bail) ; le mode et l'IBAN restent
      // dans le document (l'IBAN appartient au bailleur, pas à ce bail : le changer ici toucherait tous ses baux).
      const brut = String(d.jour == null ? '' : d.jour).trim();
      const j = parseInt(brut, 10);
      if (j >= 1 && j <= 28 && String(j) === brut) { if (pose('jpay', String(j))) appliques.push('Jour de paiement'); }
      else alertes.push('Jour de paiement invalide (1 à 28) : non appliqué.');
      if (String(d.rib || '').trim()) docSeul.push('IBAN du bailleur');
    } else if (k === 'destination') {
      const v = (typeof d.dest === 'string' && _own(_DESTINATION, d.dest)) ? _DESTINATION[d.dest] : null;
      ((v && pose('destinationLocaux', v)) ? appliques : docSeul).push(L(k));
    } else {
      docSeul.push(L(k));
    }
  }
  hc = Math.round(hc * 100) / 100;
  if (hc <= 0 && hc !== hc0) {
    // Loyer final refusé : ni le loyer ni le supplément ne sont appliqués — et on ne le prétend pas (audit lot 3a, M1).
    alertes.push('Le loyer obtenu serait nul ou négatif : non appliqué.');
    hc = hc0; docSeul.push(...surLoyer);
  } else appliques.push(...surLoyer);
  return { hc: hc !== hc0 ? hc : null, ch: ch !== ch0 ? ch : null, regime, champs, appliques, docSeul, alertes };
}
