/**
 * core/bareme-edition.js — BAIL-EN-COURS-MODIFIER-PERIODES (2026-10-06) : modifier / supprimer /
 * ajouter UNE période de l'historique du bail (DB.loyerBareme), proprement et sans rien casser.
 *
 * Module PUR et ADDITIF : aucune lecture de DB, aucune horloge (`le`, `auteur`, `evtId` sont
 * injectés par `opts`), aucune modification de loyer-bareme.js (partagé par saveBail, l'IRL,
 * l'avenant et la migration) — on importe ce qu'on réutilise, on ne touche à rien d'existant.
 *
 * RÈGLE DE DIDIER : « on ne bloque jamais l'utilisateur : des alertes, pas de blocage ».
 * `ok:false` ne désigne donc QUE une entrée inexploitable (période disparue entre l'affichage et
 * l'enregistrement, date illisible ou hors du bail, montant négatif) — jamais une décision
 * métier. Les mois déjà quittancés, le trop-perçu, l'écart avec une quittance émise sont des
 * ALERTES calculées par `impactEdition` et montrées par l'écran.
 *
 * IDENTIFIER UNE PÉRIODE : la CLÉ {ref, bailDebut, debut}, jamais l'index du tableau (le blob
 * cloud réécrit le tableau, un autre appareil le réordonne). On n'ajoute pas de champ `id` :
 * `_reprendreApres` (loyer-bareme.js) recopie l'objet entier, l'id serait dupliqué par chaque split.
 *
 * RIEN NE DISPARAÎT SANS TRACE (invariant I-E) : une période modifiée / supprimée / absorbée reste
 * dans le tableau, tombstonée AVEC SA RAISON (`_modifieePar`, `_supprimeePar`, `_absorbeePar`) —
 * la timeline (bail-historique.js) en fait une carte. Les lignes écrites portent `_edition`.
 *
 * Invariants garantis (testés : __tests__/helpers/bareme-edition*.test.js) :
 *   I-A pas de chevauchement · I-B couverture continue conservée · I-C ≤ 1 période ouverte ·
 *   I-D localité (le dû ne change que sur la fenêtre de la période) · I-E trace de tout ·
 *   I-F déterminisme, indépendance à l'ordre du tableau · I-G idempotence (même evtId → no-op).
 */
import {
  garantirCouvertureBail, appliquerNouvellePeriode, cloturerPeriodeParDebut, chapitrePour, montantSaisi
} from './loyer-bareme.js';
import { duMois, finOccupationBail, periodeEnVigueurA } from './loyer-du-mois.js';
import { verdict as verdictQuittance } from './quittance-auto.js';

const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _ymd = (iso) => String(iso == null ? '' : iso).slice(0, 10);
const _isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const _vivante = (p) => !!(p && !p._deleted);
/** Une valeur de formulaire / d'API renseignée : ni absente, ni null, ni chaîne vide. */
const _renseigne = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/** Décalage de `n` jours d'une date ISO (arithmétique UTC : aucun saut d'heure d'été). */
function _decale(iso, n) {
  const [y, m, d] = _ymd(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const _veille = (iso) => _decale(iso, -1);
const _lendemain = (iso) => _decale(iso, +1);

/** `bailDebut` absent = barème antérieur au champ : on ne peut rien conclure, donc on n'exclut pas. */
const _compat = (p, bd) => { const b = _ymd(p && p.bailDebut); return !b || !bd || b === bd; };

/** La clé d'une période : {ref, bailDebut, debut}. */
export function cleDePeriode(p) {
  return { ref: p && p.ref, bailDebut: _ymd(p && p.bailDebut), debut: _ymd(p && p.debut) };
}

/**
 * Retrouve la période VIVANTE désignée par une clé (ref tolérante, chapitre compatible).
 * Plusieurs candidates (stock corrompu) → LA DERNIÈRE du tableau (même règle que M7 des tests de
 * couverture par chapitre).
 * @returns {{idx:number, periode:Object}|null}
 */
export function trouverPeriode(periods, cle) {
  if (!cle) return null;
  let hit = null;
  const bd = _ymd(cle.bailDebut);
  for (let i = 0; i < (periods || []).length; i++) {
    const p = periods[i];
    if (!_vivante(p) || _nr(p.ref) !== _nr(cle.ref) || _ymd(p.debut) !== _ymd(cle.debut)) continue;
    if (!_compat(p, bd)) continue;
    hit = { idx: i, periode: p };
  }
  return hit;
}

const _sommaire = (p) => (p ? {
  debut: _ymd(p.debut), fin: p.fin == null ? null : _ymd(p.fin),
  hc: Number(p.hc) || 0, ch: Number(p.ch) || 0, source: p.source || 'bail'
} : null);

/** Cette opération (même evtId) a-t-elle déjà été appliquée ? (idempotence I-G, rejeu d'un autre appareil) */
function _dejaFait(arr, evtId) {
  if (!evtId) return false;
  return arr.some((p) => p && ((p._modifieePar && p._modifieePar.evtId === evtId)
    || (p._supprimeePar && p._supprimeePar.evtId === evtId)
    || (p._absorbeePar && p._absorbeePar.evtId === evtId)
    || (p._edition && p._edition.evtId === evtId)));
}

function _echec(arr, raison, extra) {
  return Object.assign({ ok: false, change: false, periods: arr, avant: null, apres: null, touchees: [], avertissements: [], raison }, extra || {});
}

/**
 * Barème ANTÉRIEUR au champ `bailDebut` : la période ne dit pas à quel bail elle appartient. `_compat` accepte alors tout,
 * et une suppression traversait les chapitres (elle prolongeait le locataire d'avant). Quand les baux du lot sont connus
 * (`opts.baux`), on déduit le chapitre de la DATE : {debut: début du bail qui occupe la date, jusqua: début du suivant}.
 * Sans baux, ou sans bail qui couvre la date : null (comportement historique, rien n'est conclu).
 */
function _chapitreDeduit(arr, T, baux) {
  if (_ymd(T.bailDebut) || !Array.isArray(baux) || !baux.length) return null;
  const cd = chapitrePour(arr, T.ref, T.debut, baux);
  if (!cd) return null;
  let jusqua = null;
  for (const b of baux) {
    const d = _ymd(b && b.debut);
    if (b && !b._deleted && d > cd && (!jusqua || d < jusqua)) jusqua = d;
  }
  return { debut: cd, jusqua };
}

/** Contexte commun d'une opération sur une période : copie, cible, voisinage. */
function _contexte(periods, cle, opts) {
  const arr = (periods || []).map((p) => ({ ...p }));
  const o = opts || {};
  if (_dejaFait(arr, o.evtId)) return { fini: Object.assign(_echec(arr, 'deja-applique'), { ok: true }) };
  const f = trouverPeriode(arr, cle);
  if (!f) return { fini: _echec(arr, 'introuvable') };
  const T = arr[f.idx];
  const deduit = _chapitreDeduit(arr, T, o.baux);
  const bd = _ymd(T.bailDebut) || (deduit ? deduit.debut : '');
  const dansChap = (p) => { const b = _ymd(p && p.bailDebut); if (b) return b === bd; const d = _ymd(p.debut); return d >= deduit.debut && (!deduit.jusqua || d < deduit.jusqua); };
  // RELECTURE ADVERSE 22/10 (🔴1) — dès que les baux du lot sont connus, une période SANS `bailDebut` (barème d'avant le
  // champ) est rattachée à un bail par SA date, même quand la période éditée, elle, porte son `bailDebut`. Sinon `_compat`
  // la rangeait dans le bail en cours : supprimer la 1re période du bail en cours prolongeait le tarif de l'ANCIEN locataire.
  const debutsBaux = (Array.isArray(o.baux) ? o.baux : []).filter((b) => b && !b._deleted && _isoOk(_ymd(b.debut))).map((b) => _ymd(b.debut)).sort();
  const chapDe = (p) => { const b = _ymd(p && p.bailDebut); if (b) return b; let c = ''; for (const d of debutsBaux) if (d <= _ymd(p.debut)) c = d; return c; };
  const lot = (p) => _vivante(p) && _nr(p.ref) === _nr(T.ref)
    && ((debutsBaux.length && bd) ? chapDe(p) === bd : (deduit ? dansChap(p) : _compat(p, bd)));
  const Td = _ymd(T.debut);
  const Tf = T.fin == null ? null : _ymd(T.fin);
  const autres = arr.filter((p) => p !== T && lot(p));
  return { arr, o, T, idx: f.idx, bd, lot, Td, Tf, autres, le: o.le || '', evtId: o.evtId || null };
}

/**
 * Le tarif du bail du chapitre, pour combler un trou (garantirCouvertureBail). Sans tarif connu (bail introuvable,
 * `baux_historique` incomplet), le comblement prenait la période juste avant le trou — qui peut appartenir au locataire
 * PRÉCÉDENT (`_periodeJusteAvant` ne filtre pas par chapitre ; contre-audit 06/10 🟡10 : 600 € au lieu de 900 €).
 * Repli : le tarif de la période éditée elle-même, qui est du même chapitre.
 */
const _bailPour = (T, bd, o) => {
  const b = (o.baux || []).find((x) => x && !x._deleted && _ymd(x.debut) === bd);
  const pick = (v, k) => [v, b && b[k], T[k]].find((x) => montantSaisi(x) != null);
  return { ref: T.ref, debut: bd, hc: pick(o.bailHc, 'hc'), ch: pick(o.bailCh, 'ch') };
};

/**
 * Modifie une période : date d'effet (début), loyer HC, charges. `patch = {debut?, hc?, ch?}` ;
 * un champ absent ou vide est INCHANGÉ (un champ vide n'est pas un zéro : `montantSaisi`).
 * `opts = {motif, le, auteur, evtId, bailHc?, bailCh?, autoriserIRL?}` — `bailHc/bailCh` : le
 * tarif du bail du chapitre, pour combler un trou préexistant (comme le fait duMois).
 *
 *  - 1ʳᵉ période du chapitre : sa date EST celle du bail → ignorée + avertissement ;
 *  - période issue d'une révision IRL (sans `autoriserIRL`) : seules les charges se modifient ici
 *    (date et loyer passent par les gestes IRL) → avertissement `irl-geste-dedie` ;
 *  - reculer la date : la période précédente (contiguë) est PROLONGÉE ;
 *  - avancer la date : les périodes entièrement recouvertes sont ABSORBÉES, celle qui chevauche est ROGNÉE ;
 *  - la fin de la période ne bouge pas (seule la date de début se modifie).
 */
export function modifierPeriode(periods, cle, patch, opts) {
  const c = _contexte(periods, cle, opts);
  if (c.fini) return c.fini;
  const { arr, o, T, idx, bd, lot, Td, Tf, le, evtId } = c;
  const pt = patch || {};
  const avert = [];
  const irl = T.source === 'irl' && !o.autoriserIRL;

  // ── montants
  let mH = pt.hc !== undefined ? montantSaisi(pt.hc) : null;
  const mC = pt.ch !== undefined ? montantSaisi(pt.ch) : null;
  // Un montant PRÉSENT mais non numérique ('abc', NaN) n'est pas « inchangé » : c'est une erreur dite, pas un refus muet.
  if ((_renseigne(pt.hc) && mH == null) || (_renseigne(pt.ch) && mC == null)) return _echec(arr, 'montant-invalide');
  if ((mH != null && mH < 0) || (mC != null && mC < 0)) return _echec(arr, 'montant-invalide');
  if (irl && mH != null && mH !== (Number(T.hc) || 0)) { avert.push('irl-geste-dedie'); mH = null; }
  const hc = mH != null ? mH : T.hc;
  const ch = mC != null ? mC : T.ch;

  // ── date
  let d2 = Td;
  if (pt.debut !== undefined && pt.debut !== null && pt.debut !== '') {
    const d = _ymd(pt.debut);
    if (!_isoOk(d)) return _echec(arr, 'date-invalide');
    d2 = d;
  }
  const premiere = bd ? Td === bd : !c.autres.some((p) => _ymd(p.debut) < Td);
  if (d2 !== Td) {
    if (irl) { if (!avert.includes('irl-geste-dedie')) avert.push('irl-geste-dedie'); d2 = Td; }
    else if (premiere) { avert.push('premiere-periode-date'); d2 = Td; }
    else if (d2 > Td && Tf != null && d2 > Tf) return _echec(arr, 'date-apres-fin');
    else if (d2 < Td && bd && d2 < bd) return _echec(arr, 'avant-bail');
  }

  // ── rien ne change : no-op, aucune trace
  if (d2 === Td && (Number(hc) || 0) === (Number(T.hc) || 0) && (Number(ch) || 0) === (Number(T.ch) || 0)) {
    return { ok: true, change: false, periods: arr, avant: _sommaire(T), apres: _sommaire(T), touchees: [], avertissements: avert };
  }

  const touchees = [];
  if (d2 > Td) {
    // RECULER : la précédente, si elle était contiguë, est prolongée jusqu'à la veille de la nouvelle date.
    let iP = -1;
    arr.forEach((p, i) => {
      if (p !== T && lot(p) && p.fin != null && _ymd(p.fin) === _veille(Td) && (iP < 0 || _ymd(p.debut) > _ymd(arr[iP].debut))) iP = i;
    });
    if (iP >= 0) {
      const P = arr[iP];
      arr[iP] = { ...P, fin: _veille(d2) };
      if (le) arr[iP]._modifiedAt = le;
      touchees.push({ cle: cleDePeriode(P), champ: 'fin', avant: _ymd(P.fin), apres: _veille(d2) });
    } else avert.push('trou-preexistant');
  } else if (d2 < Td) {
    // AVANCER : absorber ce qui est entièrement recouvert, rogner ce qui chevauche la nouvelle date.
    arr.forEach((p, i) => {
      if (p === T || !lot(p)) return;
      const pd = _ymd(p.debut), pf = p.fin == null ? null : _ymd(p.fin);
      if (pd >= d2 && pd < Td) {
        arr[i] = { ...p, _deleted: true, _absorbeePar: { debut: d2, hc: Number(hc) || 0, ch: Number(ch) || 0, le, evtId } };
        if (le) arr[i]._modifiedAt = le;
        touchees.push({ cle: cleDePeriode(p), champ: 'absorbee', avant: _sommaire(p), apres: null });
        if (p.source === 'irl') avert.push('absorbe-irl');
      } else if (pd < d2 && (pf == null || pf >= d2)) {
        arr[i] = { ...p, fin: _veille(d2) };
        if (le) arr[i]._modifiedAt = le;
        touchees.push({ cle: cleDePeriode(p), champ: 'fin', avant: pf, apres: _veille(d2) });
      }
    });
  }

  // ── la source : irl reste irl ; la 1re période « bail » reste « bail » ; une autre période « bail »
  //    (continuation dérivée, complément de couverture) devient « manuel » — sinon appliquerNouvellePeriode
  //    la traiterait encore comme dérivée et la supersèderait en silence à la prochaine révision.
  const src = T.source || 'bail';
  const s2 = (src === 'bail' && !premiere) ? 'manuel' : src;

  arr[idx] = { ...T, _deleted: true, _modifieePar: { debut: d2, hc: Number(hc) || 0, ch: Number(ch) || 0, le, auteur: o.auteur || '', evtId, motif: o.motif || '' } };
  if (le) arr[idx]._modifiedAt = le;
  const ligne = {
    ref: T.ref, debut: d2, fin: T.fin == null ? null : _ymd(T.fin),
    hc: Number(hc) || 0, ch: Number(ch) || 0, source: s2,
    note: T.note || '', _edition: { evtId, de: src, le }
  };
  if (T.bailDebut != null) ligne.bailDebut = T.bailDebut;
  if (le) ligne._modifiedAt = le;
  arr.push(ligne);

  const out = bd ? garantirCouvertureBail(arr, _bailPour(T, bd, o), d2) : arr;
  return { ok: true, change: true, periods: out, avant: _sommaire(T), apres: _sommaire(ligne), touchees, avertissements: avert };
}

/**
 * Supprime une période. Les mois qu'elle couvrait prennent le tarif de la période PRÉCÉDENTE
 * (celle-ci est prolongée) : c'est le sens « annuler cette modification ».
 *  - 1ʳᵉ période du chapitre : ses mois prennent le tarif de la SUIVANTE (une ligne `source:'bail'`
 *    est écrite — déplacer la suivante casserait son lien IRL) + avertissement `premiere-periode-supprimee` ;
 *  - seule période (ou trou avant elle) : ses mois prennent le tarif du bail du chapitre, écrit explicitement ;
 *  - période de clôture : la précédente prend SA fin — jamais au-delà de la clôture.
 * Une période issue d'une révision IRL n'est pas supprimable ici (`irl-geste-dedie` : « Annuler la
 * révision »), sauf `opts.autoriserIRL`.
 */
export function supprimerPeriode(periods, cle, opts) {
  const c = _contexte(periods, cle, opts);
  if (c.fini) return c.fini;
  const { arr, o, T, idx, bd, lot, Td, Tf, le, evtId } = c;
  if (T.source === 'irl' && !o.autoriserIRL) return _echec(arr, 'irl-geste-dedie');
  const avert = [];
  const touchees = [];

  let iP = -1;
  arr.forEach((p, i) => {
    if (p !== T && lot(p) && p.fin != null && _ymd(p.fin) === _veille(Td) && (iP < 0 || _ymd(p.debut) > _ymd(arr[iP].debut))) iP = i;
  });
  const avant = c.autres.some((p) => _ymd(p.debut) < Td);
  let N = null;
  for (const p of c.autres) if (_ymd(p.debut) > Td && (!N || _ymd(p.debut) < _ymd(N.debut))) N = p;

  let reprise;
  let filler = null;
  if (iP >= 0) {
    const P = arr[iP];
    arr[iP] = { ...P, fin: Tf };
    if (le) arr[iP]._modifiedAt = le;
    touchees.push({ cle: cleDePeriode(P), champ: 'fin', avant: _ymd(P.fin), apres: Tf });
    reprise = 'precedente';
  } else if (!avant) {
    if (N) {
      filler = {
        ref: T.ref, debut: Td, fin: Tf, hc: Number(N.hc) || 0, ch: Number(N.ch) || 0, source: 'bail',
        note: 'Période supprimée — tarif de la période suivante', _edition: { evtId, de: T.source || 'bail', le }
      };
      if (T.bailDebut != null) filler.bailDebut = T.bailDebut;
      if (le) filler._modifiedAt = le;
      avert.push('premiere-periode-supprimee');
      reprise = 'suivante';
    } else { avert.push('seule-periode'); reprise = 'bail'; }
  } else { avert.push('trou-preexistant'); reprise = 'bail'; }
  // RELECTURE ADVERSE 22/10 (🟠3) — reprise « bail » : la ligne est ÉCRITE, au tarif du bail DU MÊME CHAPITRE, sur les mois
  // de la période supprimée. S'en remettre à la couverture générale ne suffisait pas : une période restée ouverte d'un AUTRE
  // bail passe pour « couvrante » (`_segmentsManquants`) et ses mois retombaient au tarif de l'ancien locataire.
  if (reprise === 'bail' && bd) {
    const tb = _bailPour(T, bd, o);
    filler = {
      ref: T.ref, debut: Td, fin: Tf, hc: Number(tb.hc) || 0, ch: Number(tb.ch) || 0, source: 'bail', bailDebut: bd,
      note: 'Période supprimée — tarif du bail', _edition: { evtId, de: T.source || 'bail', le }
    };
    if (le) filler._modifiedAt = le;
  }

  arr[idx] = { ...T, _deleted: true, _supprimeePar: { le, auteur: o.auteur || '', evtId, motif: o.motif || '', reprise } };
  if (le) arr[idx]._modifiedAt = le;
  if (filler) arr.push(filler);
  // Filet : un trou (suppression de la seule période, trou préexistant) est comblé au tarif du bail
  // — borné à la fin de la période supprimée, pour ne jamais rouvrir un bail clos.
  const out = bd ? garantirCouvertureBail(arr, _bailPour(T, bd, o), Tf ? _lendemain(Tf) : undefined) : arr;
  return { ok: true, change: true, periods: out, avant: _sommaire(T), apres: filler ? _sommaire(filler) : null, touchees, avertissements: avert };
}

/** Diff des lignes vivantes avant/après : fins changées, lignes disparues (remplacées). */
function _diffTouchees(avant, apres) {
  const k = (p) => `${_nr(p.ref)}|${_ymd(p.bailDebut)}|${_ymd(p.debut)}`;
  const mapApres = new Map();
  apres.forEach((p) => { if (_vivante(p)) mapApres.set(k(p), p); });
  const out = [];
  for (const p of avant) {
    if (!_vivante(p)) continue;
    const q = mapApres.get(k(p));
    if (!q) out.push({ cle: cleDePeriode(p), champ: 'remplacee', avant: _sommaire(p), apres: null });
    else if (_ymd(q.fin) !== _ymd(p.fin) || (q.fin == null) !== (p.fin == null)) {
      out.push({ cle: cleDePeriode(p), champ: 'fin', avant: p.fin == null ? null : _ymd(p.fin), apres: q.fin == null ? null : _ymd(q.fin) });
    }
  }
  return out;
}

/**
 * Ajoute une période manquante : fine enveloppe autour de l'EXISTANT (même séquence que l'ancien
 * geste « Corriger une période », retiré) — couverture garantie avant la date, puis `appliquerNouvellePeriode`
 * (coupe la période en vigueur, se borne sur la prochaine décision), puis fin explicite éventuelle.
 * `nouvelle = {ref, debut, fin?, hc, ch, bailDebut?}` ; `opts = {motif, le, auteur, evtId, baux?,
 * bailHc?, bailCh?}` (`baux` : baux du lot, pour rattacher la date au bon chapitre).
 */
export function ajouterPeriode(periods, nouvelle, opts) {
  const arr = (periods || []).map((p) => ({ ...p }));
  const o = opts || {};
  const n = nouvelle || {};
  if (_dejaFait(arr, o.evtId)) return Object.assign(_echec(arr, 'deja-applique'), { ok: true });
  const debut = _ymd(n.debut);
  if (!_isoOk(debut)) return _echec(arr, 'date-invalide');
  const hc = montantSaisi(n.hc);
  const ch = montantSaisi(n.ch);
  if (hc == null) return _echec(arr, 'montant-invalide');
  if (hc < 0 || (ch != null && ch < 0)) return _echec(arr, 'montant-invalide');
  if (_renseigne(n.ch) && ch == null) return _echec(arr, 'montant-invalide');   // 'abc' / NaN : erreur dite, pas un zéro
  const bd = _ymd(n.bailDebut) || chapitrePour(arr, n.ref, debut, o.baux || []);
  if (!bd) return _echec(arr, 'aucun-bail');
  if (debut < bd) return _echec(arr, 'avant-bail', { bailDebut: bd });
  // La fin d'occupation du bail du chapitre (LA même que le dû) : une période ajoutée dans un bail CLOS ne la déborde jamais
  // (sinon elle chevauche la vacance, et un ré-ancrage ultérieur du bail suivant créerait un chevauchement).
  let finChap = _ymd(o.finChapitre);
  if (!finChap) {
    const bc = (o.baux || []).find((b) => b && !b._deleted && _ymd(b.debut) === bd);
    finChap = bc ? _ymd(finOccupationBail(bc, bc.archive !== false)) : '';
  }
  if (finChap && debut > finChap) return _echec(arr, 'apres-cloture', { finChapitre: finChap });
  let fin = n.fin ? _ymd(n.fin) : null;
  if (fin && (!_isoOk(fin) || fin < debut)) return _echec(arr, 'fin-invalide');
  if (finChap && (!fin || fin > finChap)) fin = finChap;
  const avert = [];
  const memeDebut = arr.filter((p) => _vivante(p) && _nr(p.ref) === _nr(n.ref) && _ymd(p.debut) === debut && _compat(p, bd));
  if (memeDebut.length) avert.push('remplace-periode');
  // RELECTURE ADVERSE 22/10 (🟠4, D2) — remplacer la période d'une révision IRL par « Ajouter » laisse l'historique IRL dire
  // l'inverse (et « Supprimer cette révision » ne retrouve plus sa période). On ne bloque pas : on le DIT, avec le bon geste.
  if (memeDebut.some((p) => p.source === 'irl')) avert.push('remplace-irl');

  const le = o.le || '';
  const orig = arr.map((p) => ({ ...p }));
  // RELECTURE FABLE 22/10 (🟠1) — barème « mal refermé » : une période d'un bail CLOS restée ouverte (ou qui déborde sa fin
  // d'occupation) serait coupée puis RESSUSCITÉE par appliquerNouvellePeriode (_reprendreApres) au lendemain de la clôture,
  // c'est-à-dire sur les mois du bail suivant, au tarif de l'ancien locataire. On la ramène d'abord à la fin d'occupation
  // (c'est la règle du dû : duMois borne déjà ce bail à cette date), et on le DIT.
  const bcClos = (o.baux || []).find((b) => b && !b._deleted && _ymd(b.debut) === bd);
  if (finChap && (o.finChapitre || (bcClos && bcClos.archive !== false))) {
    let referme = false;
    for (let k = 0; k < arr.length; k++) {
      const p = arr[k];
      if (!_vivante(p) || _nr(p.ref) !== _nr(n.ref) || _ymd(p.debut) > finChap) continue;
      const pb = _ymd(p.bailDebut);
      if (pb ? pb !== bd : _ymd(p.debut) < bd) continue;
      if (p.fin == null || _ymd(p.fin) > finChap) { arr[k] = { ...p, fin: finChap }; if (le) arr[k]._modifiedAt = le; referme = true; }
    }
    if (referme) avert.push('chapitre-referme');
  }
  // Tarif du bail inconnu (🟡10) : le bail du chapitre dans `opts.baux`, sinon la 1re période vivante DU CHAPITRE — jamais la voisine
  // d'un autre bail. Rien de connu : pas de comblement (duMois résout ces mois au tarif du bail, repli « bail »).
  const bcT = (o.baux || []).find((b) => b && !b._deleted && _ymd(b.debut) === bd);
  const premChap = arr.filter((p) => _vivante(p) && _nr(p.ref) === _nr(n.ref) && _ymd(p.bailDebut) === bd)
    .sort((a, b) => _ymd(a.debut).localeCompare(_ymd(b.debut)))[0];
  const tarifBail = (v, k) => [v, bcT && bcT[k], premChap && premChap[k]].find((x) => montantSaisi(x) != null);
  const tH = tarifBail(o.bailHc, 'hc'), tC = tarifBail(o.bailCh, 'ch');
  let out = tH != null ? garantirCouvertureBail(arr, { ref: n.ref, debut: bd, hc: tH, ch: tC }, debut) : arr.map((p) => ({ ...p }));
  // CHARGES VIDES : « un champ vide n'est pas un zéro » (LOT 3). Elles reprennent la provision de la période en vigueur à cette
  // date (sinon celle du bail) ; faute de source, 0 — mais DIT (`charges-vides`), jamais en silence.
  let chFinal = ch;
  if (chFinal == null) {
    const encours = out.filter((p) => _vivante(p) && _nr(p.ref) === _nr(n.ref) && _compat(p, bd) && _ymd(p.debut) <= debut && (p.fin == null || _ymd(p.fin) >= debut))
      .sort((a, b) => _ymd(b.debut).localeCompare(_ymd(a.debut)))[0];
    const repris = montantSaisi(encours && encours.ch);
    const bailCh = montantSaisi(o.bailCh);
    chFinal = repris != null ? repris : (bailCh != null ? bailCh : 0);
    avert.push(repris != null || bailCh != null ? 'charges-reprises' : 'charges-vides');
  }
  out = appliquerNouvellePeriode(out, { ref: n.ref, debut, fin, hc, ch: chFinal, source: 'manuel', bailDebut: bd, note: o.motif || '' });
  if (fin) out = cloturerPeriodeParDebut(out, n.ref, debut, fin);
  const change = JSON.stringify(out) !== JSON.stringify(orig);
  if (!change) return { ok: true, change: false, periods: orig, avant: null, apres: null, touchees: [], avertissements: avert };
  const last = out[out.length - 1];
  let apres = null;
  if (last && _vivante(last) && _ymd(last.debut) === debut && last.source === 'manuel') {
    last._edition = { evtId: o.evtId || null, de: null, le };
    if (le) last._modifiedAt = le;
    apres = _sommaire(last);
  }
  return { ok: true, change: true, periods: out, avant: null, apres, touchees: _diffTouchees(orig, out), avertissements: avert };
}

// ════════════════════════════════════════════════════════════════════════════
// IMPACT « avant / après » — ce que l'écran dit AVANT d'enregistrer (alerte NON bloquante).
// Lecture seule de duMois() : le chiffre affiché est exactement celui que Finances, Loyers et les
// quittances afficheront ensuite — aucun moteur concurrent.
// ════════════════════════════════════════════════════════════════════════════
const _ymOf = (d) => _ymd(d).slice(0, 7);
function _ymPlus(ym, n) {
  const y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}`;
}
const _cleLigne = (p) => `${_ymd(p.bailDebut)}|${_ymd(p.debut)}|${p.fin == null ? '' : _ymd(p.fin)}|${Number(p.hc) || 0}|${Number(p.ch) || 0}`;
const _tot = (d) => ({ hc: d.hc, ch: d.ch, total: d.total });
const _r2 = (n) => Math.round(n * 100) / 100;

/**
 * Les mois dont le dû change entre deux barèmes d'un même lot.
 * @param {{ref:string, bails:Array, avant:Array, apres:Array, jusquAu?:string}} input
 *   `bails` : forme attendue par duMois (bailsFromRaw) ; `jusquAu` : le mois courant ('YYYY-MM' ou
 *   date) — les mois au-delà sont le FUTUR (pas de trop-perçu, pas de quittance), sans jusquAu tout est passé.
 * @returns {{mois:Array<{ym,avant,apres,delta}>, futur:{ym,des,avant,apres,delta,nbMois,ouvert}|null,
 *            fenetre:{debut:'YYYY-MM', fin:'YYYY-MM'|null}|null, deltaTotal:number}}
 *   `fenetre` = premier et dernier mois dont le dû change (`fin:null` : l'écart se poursuit sans fin) ;
 *   `futur.ouvert` : l'écart du futur n'a pas de fin (« à partir de… »).
 */
export function impactEdition(input) {
  const i = input || {};
  const vv = (b) => (b || []).filter((p) => _vivante(p) && _nr(p.ref) === _nr(i.ref) && p.debut);
  const A = vv(i.avant), B = vv(i.apres);
  const setA = new Set(A.map(_cleLigne)), setB = new Set(B.map(_cleLigne));
  const diff = A.filter((p) => !setB.has(_cleLigne(p))).concat(B.filter((p) => !setA.has(_cleLigne(p))));
  const vide = { mois: [], futur: null, fenetre: null, deltaTotal: 0 };
  if (!diff.length) return vide;
  let debut = '9999-99-99', fin = '', ouverte = false;
  for (const p of diff) {
    const d = _ymd(p.debut);
    if (d < debut) debut = d;
    if (p.fin == null) ouverte = true; else if (_ymd(p.fin) > fin) fin = _ymd(p.fin);
  }
  const cur = i.jusquAu ? _ymOf(i.jusquAu) : null;
  const ym0 = _ymOf(debut);
  const ymFin = ouverte ? null : _ymOf(fin);
  let limite = ymFin;
  if (ouverte) limite = _ymPlus(cur && cur > ym0 ? cur : ym0, 36);
  const ctxA = { ref: i.ref, bails: i.bails || [], bareme: i.avant || [] };
  const ctxB = { ref: i.ref, bails: i.bails || [], bareme: i.apres || [] };
  const mois = [];
  let futur = null, nbFutur = 0, premier = '', dernier = '';
  for (let ym = ym0, n = 0; ym <= limite && n < 600; ym = _ymPlus(ym, 1), n++) {
    const a = duMois(ctxA, ym), b = duMois(ctxB, ym);
    if (a.hc === b.hc && a.ch === b.ch) continue;
    if (!premier) premier = ym;
    dernier = ym;
    const ligne = { ym, avant: _tot(a), apres: _tot(b), delta: _r2(b.total - a.total) };
    if (cur && ym > cur) {
      nbFutur++;
      if (!futur) futur = { ym, des: ym + '-01', avant: ligne.avant, apres: ligne.apres, delta: ligne.delta, nbMois: 0 };
    } else mois.push(ligne);
  }
  const sansFin = ouverte && dernier === limite;
  if (futur) { futur.nbMois = nbFutur; futur.ouvert = sansFin; }
  if (!premier) return vide;
  return { mois, futur, fenetre: { debut: premier, fin: sansFin ? null : dernier }, deltaTotal: _r2(mois.reduce((s, m) => s + m.delta, 0)) };
}

const _refSans = (r) => String(r == null ? '' : r).split('@@')[0];

// ════════════════════════════════════════════════════════════════════════════
// SYNTHÈSE DE L'IMPACT — ce que la fenêtre dit AVANT d'enregistrer (décision D4, GO Didier 22/10/2026). Jamais un blocage.
// AUCUN CALCUL D'ARGENT ICI (règle « un seul endroit pour l'argent ») : les dus viennent de duMois (`impactEdition`), le
// reste dû, l'avance et « le mois est-il payé en entier » viennent du MOTEUR du suivi — l'app lance `_computeSuiviLot` sur le
// barème d'avant puis sur celui d'après et passe les deux `etatDepuisSuivi`. Cette fonction compare et compte, rien d'autre.
//
//  - une quittance émise ne change jamais (le document est stocké) ;
//  - un mois quittancé qui n'est plus payé en entier perd sa quittance dans l'espace du locataire (règle v15.769,
//    `QuittanceAuto.verdict` → 'non_solde' ; elle reste au registre) — on le DIT avant ;
//  - la déclaration (2044) ne change pas : elle compte l'argent reçu (ligne 211), pas le dû ;
//  - une régularisation de charges déjà validée qui couvre un mois dont la provision change est « à revoir » (les
//    provisions versées s'imputent selon la provision due) — signalée, jamais refaite d'office ;
//  - une révision IRL programmée calculée sur un loyer que l'édition change : le moteur IRL ne l'appliquerait pas.
// ════════════════════════════════════════════════════════════════════════════
// La règle v15.769 du dépôt automatique (QuittanceAuto.verdict) : un mois « solde » garde sa quittance dans l'espace du locataire.
const _quittancable = (etat, ym) => !!(etat && verdictQuittance(etat, ym, null) === 'solde');

/**
 * @param {Object} input
 * @param {Object} input.impact sortie d'`impactEdition`
 * @param {Object|null} input.etatAvant `etatDepuisSuivi` du moteur, barème d'avant (null : moteur indisponible)
 * @param {Object|null} input.etatApres idem, barème d'après
 * @param {string[]} [input.quittancesYm] mois ('YYYY-MM') du lot qui ont une quittance au registre
 * @param {Array<{du:string, au:string}>} [input.regulValidations] régularisations validées du logement
 * @param {string} input.aujourdhui 'YYYY-MM-DD'
 * @param {{dateEffet:string, ancienHC:number, nouveauHC:number}|null} [input.irlProgrammee] (`irlProgrammeeDuLot`)
 * @param {string} [input.ref] @param {Array} [input.avant] @param {Array} [input.apres] barèmes (pour l'IRL programmée)
 * @param {{clos:boolean, soldeEtabli:boolean}} [input.bail] bail du chapitre de la période
 * @param {string|null} [input.debutSuivi] début du suivi du lot (achat, antériorité) : les mois d'avant ne sont comptés
 *   nulle part (Finances, Loyers) — ils ne sont pas annoncés non plus.
 */
export function syntheseImpact(input) {
  const i = input || {};
  const imp = i.impact || { mois: [], futur: null, fenetre: null, deltaTotal: 0 };
  const eA = i.etatAvant || null, eB = i.etatApres || null;
  const auj = _ymd(i.aujourdhui);
  const annee = parseInt(auj.slice(0, 4), 10);
  const qSet = new Set((i.quittancesYm || []).map((x) => String(x).slice(0, 7)));
  const dS = _ymd(i.debutSuivi).slice(0, 7);
  const mois = (imp.mois || []).filter((m) => !dS || m.ym >= dS).map((m) => {
    const b = eB && eB.byYm ? eB.byYm[m.ym] : null;
    return { ym: m.ym, avant: m.avant, apres: m.apres, delta: m.delta,
      recu: b ? b.received : null, resteApres: b ? b.reste : null, quittance: qSet.has(m.ym) };
  });
  const quittancees = mois.filter((m) => m.quittance).map((m) => m.ym);
  // RELECTURE ADVERSE 22/10 (🟠2) — TOUS les mois quittancés, pas seulement ceux dont le dû change : le moteur impute un
  // trop-perçu sur la dette la plus ancienne, un mois au dû inchangé peut cesser d'être payé en entier.
  const quittancesNonSoldees = [...qSet].sort().filter((ym) => _quittancable(eA, ym) && !_quittancable(eB, ym));
  // Déclaration de l'année N : déposée au printemps N+1 → réputée faite à partir du 1er juin N+1.
  const anneesDeclarees = [...new Set(mois.map((m) => parseInt(m.ym.slice(0, 4), 10)))]
    .filter((y) => Number.isInteger(y) && auj >= `${y + 1}-06-01`).sort();
  // La régularisation compte les provisions VERSÉES (imputations « charge » du moteur), pas seulement les dues : l'ordre
  // loyer d'abord fait qu'un changement de LOYER peut changer la provision versée d'un mois, ou d'un autre par cascade
  // (relecture Fable 22/10, 🟠2). Lu dans les deux états du moteur, aucun calcul nouveau.
  const versee = (e, ym) => {
    const x = e && e.byYm ? e.byYm[ym] : null;
    return x ? (x.paiements || []).filter((p) => p.poste === 'charge').reduce((t, p) => t + (Number(p.montant) || 0), 0) : 0;
  };
  const ymsEtat = new Set([...Object.keys((eA && eA.byYm) || {}), ...Object.keys((eB && eB.byYm) || {})]);
  const chChange = [...new Set(mois.filter((m) => (Number(m.avant && m.avant.ch) || 0) !== (Number(m.apres && m.apres.ch) || 0)).map((m) => m.ym)
    .concat([...ymsEtat].filter((ym) => (!dS || ym >= dS) && Math.abs(versee(eA, ym) - versee(eB, ym)) > 0.004)))];
  const regulsARevoir = (i.regulValidations || []).filter((v) => v && _isoOk(_ymd(v.du)) && _isoOk(_ymd(v.au))
    && chChange.some((ym) => ym >= _ymd(v.du).slice(0, 7) && ym <= _ymd(v.au).slice(0, 7)))
    .map((v) => ({ du: _ymd(v.du), au: _ymd(v.au) }));
  let irlARefaire = null;
  const rv = i.irlProgrammee;
  if (rv && _isoOk(_ymd(rv.dateEffet))) {
    const veille = _veille(rv.dateEffet);
    const pA = periodeEnVigueurA(i.avant || [], i.ref, veille), pB = periodeEnVigueurA(i.apres || [], i.ref, veille);
    const hA = pA ? Number(pA.hc) : null, hB = pB ? Number(pB.hc) : null;
    if (hB != null && hB !== Number(rv.ancienHC) && hA !== hB) irlARefaire = { dateEffet: _ymd(rv.dateEffet), ancienHC: Number(rv.ancienHC), nouveauHC: Number(rv.nouveauHC), base: hB };
  }
  const bail = i.bail || {};
  return {
    change: !!(mois.length || imp.futur),
    // Mois dont le dû change AVANT le début du suivi (achat, antériorité) : comptés nulle part, mais le dire.
    horsSuivi: (imp.mois || []).length - mois.length, debutSuivi: dS ? _ymd(i.debutSuivi) : null,
    nbMois: mois.length, fenetre: imp.fenetre || null, deltaTotal: _r2(mois.reduce((s, m) => s + m.delta, 0)), futur: imp.futur || null,
    mois,
    resteDelta: (eA && eB) ? _r2((Number(eB.reste) || 0) - (Number(eA.reste) || 0)) : null,
    avanceDelta: (eA && eB) ? _r2((Number(eB.avance) || 0) - (Number(eA.avance) || 0)) : null,
    quittancees, quittancesNonSoldees,
    anneesDeclarees: Number.isInteger(annee) ? anneesDeclarees : [],
    regulsARevoir, irlARefaire,
    bailClos: !!bail.clos && mois.length > 0, soldeEtabli: !!(bail.clos && bail.soldeEtabli && mois.length > 0)
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RÉVISION IRL PROGRAMMÉE — le moteur IRL (`_applyPendingIRLRevisions`) ne l'applique que si le loyer vivant du lot vaut encore
// `ancienHC`. Modifier le loyer en vigueur le change. La fenêtre le DIT avant d'enregistrer (alerte non bloquante) ; au jour
// de l'effet, le moteur ne la saute plus : elle passe « à vérifier » avec son motif (IRL-MOTEUR, v15.776, js/core/irl-revision.js).
// ════════════════════════════════════════════════════════════════════════════
/**
 * @param {Array} irlHistorique DB.irlHistorique
 * @param {string} ref
 * @param {{debutBail?:string}} [opts] une révision d'un cycle antérieur au bail en cours ne le concerne pas
 * @returns {{dateEffet:string, ancienHC:number, nouveauHC:number, cycle:string}|null} la plus récente en attente, sinon null
 */
export function irlProgrammeeDuLot(irlHistorique, ref, opts) {
  const want = _nr(_refSans(ref));
  const debut = _ymd(opts && opts.debutBail);
  let best = null;
  for (const h of (irlHistorique || [])) {
    if (!h || h._deleted || h.action === 'renonciation' || !h.pendingApply || _nr(_refSans(h.ref)) !== want) continue;
    const eff = _ymd(h.dateEffet) || _ymd(h.dateApplication);
    const cyc = _ymd(h.dateRevision);
    if (!_isoOk(eff) || (debut && cyc && cyc < debut)) continue;
    if (!best || eff > best.dateEffet) best = { dateEffet: eff, ancienHC: Number(h.ancienHC), nouveauHC: Number(h.nouveauHC), cycle: cyc };
  }
  return best;
}
