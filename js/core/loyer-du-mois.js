/**
 * core/loyer-du-mois.js — AUDIT-SUIVI-LOYERS étape 1 (2026-07-15) :
 * LE résolveur unique du dû d'un mois (audit docs/subjects/AUDIT-SUIVI-LOYERS-2026-07-14.md,
 * décisions actées 14/07). Remplace à terme les 4 moteurs divergents
 * (_finBailHcChAt / _suiviLoyerStrip / _v4ComputeLotStatus / _pilCumulLocataire).
 *
 * Le fil conducteur : le loyer d'un mois est une DONNÉE, pas une déduction.
 *   1. Mois QUITTANCÉ → le montant de la quittance émise, figé (B3 : re-imprimer ≠ re-calculer).
 *   2. Sinon → le barème historisé DB.loyerBareme (périodes datées ; une révision IRL
 *      porte une date d'effet EXPLICITE, jamais rétroactive — Q1).
 *   3. Sinon (barème absent/lacunaire) → repli hc/ch du bail du segment (figé pour un
 *      bail archivé, courant pour le bail actif) — comblé par la migration (étape 3).
 *
 * Occupation (les baux) :
 *   - tombstones filtrés (C10) ;
 *   - la fin qui compte pour le dû est finEffective (clôture) ; la fin CONTRACTUELLE d'un
 *     bail COURANT est ignorée (tacite reconduction, C7 : un reconduit qui cesse de payer
 *     reste visible) ; un bail archivé sans finEffective retombe sur sa fin papier ;
 *   - chevauchements TRONQUÉS défensivement (un lot n'a qu'un occupant à la fois) : l'ancien
 *     bail s'arrête à la veille du suivant (C4/CAS 5 : fin du dû doublé au re-bail) ;
 *   - prorata jours d'occupation (entrée/sortie/transition intra-mois, loi 6 juil. 1989).
 *
 * Pur / testable : aucune lecture de DB — tout le contexte est injecté.
 * Tests : __tests__/helpers/loyer-du-mois.test.js (CAS 0-6 du harness
 * _import/repro-audit-suivi-loyers.mjs, encodés en comportement ATTENDU).
 */

import { premierMontantSaisi } from './loyer-bareme.js';
import { finOccupationBail } from './fin-occupation.js';

const _r2 = (n) => Math.round(n * 100) / 100;
const _isAlive = (o) => !!o && !o._deleted;
// Ref TOLÉRANTE (trim + minuscule), même politique que _loyerHCAtDate/_findBailByRefTolerant :
// une période enregistrée avec une ref légèrement différente reste rattachée (CAS 3).
const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _isoShift = (iso, jours) => {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  d.setDate(d.getDate() + jours);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const _isoVeille = (iso) => _isoShift(iso, -1);
const _isoLendemain = (iso) => _isoShift(iso, +1);

/**
 * Les périodes de barème d'un lot : ref tolérante, tombstones filtrés, triées par début.
 * C'est LE sélecteur (unique) — plus jamais de filtre strict qui rend l'historique invisible.
 * @param {Array} bareme collection globale DB.loyerBareme (ou déjà scopée)
 * @param {string} ref ref du lot
 */
export function _baremeOfLot(bareme, ref) {
  const want = _nr(ref);
  return (bareme || [])
    .filter((p) => _isAlive(p) && p.debut && _nr(p.ref) === want)
    .slice()
    .sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
}

/** Période du barème en vigueur à une date (dernière dont debut <= date, fin ouverte ou >= date). */
function _periodeAt(periods, iso) {
  let hit = null;
  for (const p of periods) {
    const d = String(p.debut).slice(0, 10);
    if (d > iso) break;
    if (!p.fin || String(p.fin).slice(0, 10) >= iso) hit = p;
    else hit = null;                        // trou entre deux périodes → repli bail
  }
  return hit;
}

/**
 * Période du barème en vigueur pour un lot à une date donnée. Composition des deux
 * sélecteurs existants (_baremeOfLot + _periodeAt) — AUCUN moteur concurrent : c'est le
 * même chemin que duMois(). Exposé pour les ÉCRITURES qui ont besoin de savoir ce qui est
 * en vigueur avant d'inscrire une nouvelle période (révision IRL : reprendre la provision
 * en cours plutôt que d'inventer un 0 quand personne ne la connaît).
 * @returns {object|null} la période, ou null si le lot n'en a aucune à cette date
 */
export function periodeEnVigueurA(bareme, ref, iso) {
  return _periodeAt(_baremeOfLot(bareme, ref), String(iso == null ? '' : iso).slice(0, 10));
}

/**
 * Provision de charges à inscrire sur la période d'une RÉVISION de loyer (IRL ou batch), quand
 * la révision ne porte que le loyer HC. Chaîne des sources, dans cet ordre :
 *   1. la période EN VIGUEUR au barème à la date d'effet — c'est la provision réellement due,
 *      et la seule que met à jour une correction manuelle datée (_histoSaveCorrPeriode n'écrit
 *      QUE dans le barème : reprendre bail.ch ici annulerait silencieusement la correction) ;
 *   2. le bail, puis le lot, pour un barème lacunaire (lot non migré) ;
 *   3. 0 en dernier recours seulement — personne ne sait, et c'est dit.
 * Un champ VIDE n'est pas un zéro (montantSaisi) ; un 0 réellement saisi, lui, vaut 0.
 */
export function provisionPourRevision(bareme, ref, dateEffetIso, bailCh, logCh, bailDebut) {
  const p = periodeEnVigueurA(bareme, ref, dateEffetIso);
  // Borne (audit) : une période encore ouverte du locataire PRÉCÉDENT (barème mal refermé)
  // imposerait sa provision au bail courant. Quand on sait à quel bail on a affaire, on
  // n'accepte la période que si elle est la sienne.
  // `p.bailDebut` absent = barème antérieur au champ : on ne peut rien conclure, la borne ne
  // s'applique pas (sinon le correctif « la période en vigueur d'abord » ne vaudrait pas pour
  // les barèmes legacy, qui sont précisément ceux qui en ont le plus besoin).
  const pOk = p && (bailDebut == null || p.bailDebut == null
    || String(p.bailDebut).slice(0, 10) === String(bailDebut).slice(0, 10));
  const n = premierMontantSaisi(pOk ? p.ch : null, bailCh, logCh);
  return n != null ? n : 0;
}

/**
 * Segments d'occupation normalisés depuis les baux du lot (vivants, triés, TRONQUÉS).
 * end = null → occupation ouverte (bail courant, tacite reconduction incluse).
 */
function _occupation(bails) {
  const segs = (bails || [])
    .filter((b) => _isAlive(b) && b.debut)
    .map((b) => ({
      debut: String(b.debut).slice(0, 10),
      // Bail archivé sans finEffective NI fin (données cassées) : reste ouvert ici — la
      // troncature par le bail suivant le rattrape ; l'étape 2 (archiverBail pose
      // finEffective) ferme le cas à l'écriture, la migration (étape 3) répare le stock.
      end: b.finEffective ? String(b.finEffective).slice(0, 10)
        : (b.archive ? (b.fin ? String(b.fin).slice(0, 10) : null) : null),
      hc: Number(b.hc) || 0,
      ch: Number(b.ch) || 0
    }))
    .sort((a, b) => a.debut.localeCompare(b.debut));
  for (let i = 0; i < segs.length - 1; i++) {
    const veille = _isoVeille(segs[i + 1].debut);
    if (!segs[i].end || segs[i].end > veille) segs[i].end = veille;
  }
  return segs;
}

/**
 * LE dû d'un mois pour un lot. DÉCISION USER 16/07 : DEUX sources seulement — le bail (→ le dû,
 * via le barème = le loyer du bail dans le temps) et l'import (→ le payé, ailleurs). La QUITTANCE
 * n'entre JAMAIS dans le dû : c'est un document imprimé, pas une source (des quittances fausses ne
 * doivent plus faire naître d'avance/retard fantômes). Politiques : barème daté > repli bail.
 * @param {Object} ctx { ref, bails:[{debut,fin,finEffective,archive,hc,ch,_deleted}],
 *                       bareme:[{ref,debut,fin,hc,ch,_deleted}] }
 * @param {string} ym 'YYYY-MM'
 * @param {{segmentDebut?:string}} [opts] R0-C : `segmentDebut` ('YYYY-MM-DD', début d'un bail)
 *        restreint le dû au SEUL segment d'occupation de ce bail — après la troncature C4 par le
 *        bail suivant. Un mois de rotation porte ainsi la part de chaque locataire au jour près.
 *        Sans option : la somme de tous les segments (comportement historique inchangé).
 * @returns {{hc:number, ch:number, total:number, source:'bareme'|'bail'|'vacance'}}
 */
export function duMois(ctx, ym, opts) {
  const empty = { hc: 0, ch: 0, total: 0, source: 'vacance' };
  if (!ctx || !/^\d{4}-\d{2}$/.test(String(ym || ''))) return empty;
  ym = String(ym);

  // Occupation × barème, prorata jours. (La quittance ne participe PAS — retirée le 16/07.)
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const first = ym + '-01';
  const joursDansMois = new Date(y, m, 0).getDate();
  const last = ym + '-' + String(joursDansMois).padStart(2, '0');
  const periods = _baremeOfLot(ctx.bareme, ctx.ref);

  let hc = 0, ch = 0, usedBareme = false, occupied = false;
  const seul = (opts && opts.segmentDebut) ? String(opts.segmentDebut).slice(0, 10) : null;
  for (const seg of _occupation(ctx.bails)) {
    if (seul && seg.debut !== seul) continue;
    const d0 = seg.debut > first ? seg.debut : first;
    const d1 = (seg.end && seg.end < last) ? seg.end : last;
    if (d0 > d1) continue;
    occupied = true;
    // Sous-segments aux frontières des périodes de barème (une correction manuelle peut
    // tomber en cours de mois — Q1 ne produit que des 1ers du mois, mais on reste exact).
    const cuts = new Set([d0]);
    for (const p of periods) {
      const pd = String(p.debut).slice(0, 10);
      if (pd > d0 && pd <= d1) cuts.add(pd);
      if (p.fin) {
        const nd = _isoLendemain(String(p.fin).slice(0, 10));
        if (nd > d0 && nd <= d1) cuts.add(nd);
      }
    }
    const starts = Array.from(cuts).sort();
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const e = i + 1 < starts.length ? _isoVeille(starts[i + 1]) : d1;
      const jours = parseInt(e.slice(8, 10), 10) - parseInt(s.slice(8, 10), 10) + 1;
      if (jours <= 0) continue;
      const p = _periodeAt(periods, s);
      if (p) usedBareme = true;
      // Repli champ par champ, symétrique : une période sans hc (ou sans ch) retombe
      // sur la valeur du bail du segment.
      const rHc = p && p.hc != null ? (Number(p.hc) || 0) : seg.hc;
      const rCh = p && p.ch != null ? (Number(p.ch) || 0) : seg.ch;
      const f = jours / joursDansMois;
      hc += rHc * f;
      ch += rCh * f;
    }
  }
  if (!occupied) return empty;
  hc = _r2(hc); ch = _r2(ch);
  // `source` est un label de diagnostic : un mois MIXTE (barème sur une partie, repli
  // bail sur l'autre) est étiqueté 'bareme' — affiner à l'étape 3 si l'écran en a besoin.
  return { hc, ch, total: _r2(hc + ch), source: usedBareme ? 'bareme' : 'bail' };
}

/**
 * REFONTE FINANCES étape 2 · P-4 — le TAUX PLEIN du mois : le loyer HC du barème applicable
 * ce mois-là, SANS prorata d'entrée/sortie (« Taux plein du mois », CDC §1 P-4). Sert de
 * potentiel locatif à la clé de répartition mensuelle des frais bailleur — jamais au dû
 * (le dû reste duMois, proraté). Mois à cheval sur deux périodes de barème : le taux du
 * DERNIER sous-segment occupé (valeur post-changement — Q1 ne produit que des 1ers du mois).
 * @returns {{hc:number, ch:number, occupied:boolean}}
 */
export function tauxPleinMois(ctx, ym) {
  const empty = { hc: 0, ch: 0, occupied: false };
  if (!ctx || !/^\d{4}-\d{2}$/.test(String(ym || ''))) return empty;
  ym = String(ym);
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const first = ym + '-01';
  const last = ym + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
  const periods = _baremeOfLot(ctx.bareme, ctx.ref);
  let hit = null;
  for (const seg of _occupation(ctx.bails)) {
    const d0 = seg.debut > first ? seg.debut : first;
    const d1 = (seg.end && seg.end < last) ? seg.end : last;
    if (d0 > d1) continue;
    const p = _periodeAt(periods, d1);        // taux applicable au dernier jour occupé du segment
    hit = {
      hc: p && p.hc != null ? (Number(p.hc) || 0) : seg.hc,
      ch: p && p.ch != null ? (Number(p.ch) || 0) : seg.ch,
      occupied: true
    };
  }
  return hit || empty;
}

/** Adaptateur collections brutes → tauxPleinMois (même forme que duMoisFromRaw). */
export function tauxPleinMoisFromRaw(ref, ym, raw) {
  return tauxPleinMois({ ref, bails: bailsFromRaw(ref, raw), bareme: (raw && raw.bareme) || [] }, ym);
}

/**
 * AUDIT-SUIVI-LOYERS étape 4 — assemble le ctx duMois depuis les collections BRUTES de l'app,
 * puis délègue à duMois(). POINT D'ENTRÉE UNIQUE des 5 surfaces (via l'inline _duMoisLot).
 * La forme des baux est le point sensible : un bail COURANT à fin contractuelle passée reste
 * OUVERT (tacite reconduction, C7) — seule finEffective le clôture ; un bail archivé se clôt sur
 * finEffective|fin. On préserve donc la distinction (≠ _getAllBailsForLog qui la collapse).
 * @param {string} ref ref du lot
 * @param {string} ym 'YYYY-MM'
 * @param {Object} raw { currentBail:DB.baux[ref]|null, bauxHistorique:DB.baux_historique,
 *                       bareme:DB.loyerBareme } — la quittance n'entre PAS dans le dû (16/07).
 */
export function duMoisFromRaw(ref, ym, raw) {
  return duMois({ ref, bails: bailsFromRaw(ref, raw), bareme: (raw && raw.bareme) || [] }, ym);
}

// R0-C (2ᵉ audit 🟠2) — terme ÉCHU (`modalitePaiement` 'echu' / 'terme_echu') : seul cas où le terme
// d'un mois est exigible APRÈS une borne posée en cours de mois. Marqué seulement s'il est vrai (forme
// des baux inchangée sinon : à échoir est le défaut du bail).
const _echu = (src, b) => ((src && (src.modalitePaiement === 'echu' || src.modalitePaiement === 'terme_echu')) ? Object.assign(b, { echu: true }) : b);

// LA fin d'occupation d'un bail : js/core/fin-occupation.js (règle unique, ré-exportée ici pour main.js).
export { finOccupationBail };


/**
 * Normalisation des baux d'un lot depuis les collections BRUTES — extraite de duMoisFromRaw
 * pour être RÉUTILISÉE telle quelle par les autres consommateurs du même contexte
 * (_debutSuivi, étage « mois soldé » de loyers-mois.js). Une seule définition de la forme,
 * donc une seule règle d'occupation.
 * @param {string} ref
 * @param {Object} raw { currentBail, bauxHistorique }
 */
export function bailsFromRaw(ref, raw) {
  raw = raw || {};
  const want = _nr(ref);
  const bails = [];
  const cur = raw.currentBail;
  if (cur && !cur._deleted && cur.debut) {
    // Bail COURANT : sa fin d'occupation = LA règle (finOccupationBail) — fin contractuelle ignorée
    // (tacite reconduction, bail échu non clôturé), arrêt à la clôture ou au DÉPART DÉCLARÉ. Passée comme
    // finEffective (archive:false) : duMois proratise le mois de sortie au jour, comme une clôture.
    bails.push(_echu(cur, { debut: cur.debut, finEffective: finOccupationBail(cur, false) || null, archive: false, hc: Number(cur.hc) || 0, ch: Number(cur.ch) || 0 }));
  }
  for (const b of (raw.bauxHistorique || [])) {
    if (!b || b._deleted || !b.debut || _nr(b.ref) !== want) continue;
    bails.push(_echu(b, { debut: b.debut, fin: b.fin || null, finEffective: b.finEffective || null, archive: true, hc: Number(b.hc) || 0, ch: Number(b.ch) || 0 }));
  }
  return bails;
}

/**
 * Départ du suivi d'un lot (B2, décision user) : 1er versement du lot, avec le rattrapage
 * d'entrée réintégré (C6) — les mois entre le début du bail et le 1er versement sont DUS
 * (pas une avance) ; le bornage ne s'applique qu'aux MILLÉSIMES antérieurs au suivi
 * (les années sans données restent bornées — pas de « −63 050 € » fantôme).
 * Aucun paiement : début du bail SI un bail est encore actif (zéro paiement = pire retard,
 * pas invisible) ; sinon null (rien à suivre).
 * @param {Object} ctx même contexte que duMois
 * @param {string|null} firstPaymentYm 'YYYY-MM' du 1er versement du lot, ou null
 * @returns {string|null} 'YYYY-MM' de départ du suivi
 */
export function _debutSuivi(ctx, firstPaymentYm) {
  const segs = _occupation(ctx && ctx.bails);
  if (!segs.length) return null;
  const fp = /^\d{4}-\d{2}$/.test(String(firstPaymentYm || '')) ? String(firstPaymentYm) : null;
  if (!fp) {
    const open = segs.find((s) => !s.end);
    return open ? open.debut.slice(0, 7) : null;
  }
  let cand = null;
  for (const s of segs) { if (s.debut.slice(0, 7) <= fp) cand = s; }
  if (!cand) cand = segs[0];                       // 1er versement pendant une vacance amont
  const candYm = cand.debut.slice(0, 7);
  const janSuivi = fp.slice(0, 4) + '-01';
  return candYm > janSuivi ? candYm : janSuivi;
}

/**
 * R0-C · Q1 RÉVISÉ (décision Didier 01/10, docs/CDC-R0C.md) — LE dû d'un mois, BORNÉ au début du
 * suivi par le bailleur actuel. « Le dû part du début du bail, borné par la date d'entrée en
 * jouissance du bailleur actuel (et par la date de début de suivi si une antériorité est saisie).
 * Il ne part jamais d'une simple absence de relevés. » La règle « 1ᵉʳ janvier de l'année du 1ᵉʳ
 * versement » (`_debutSuivi`) est ABANDONNÉE pour le dû : elle fabriquait des dettes sans donnée.
 *
 * La borne est fournie par l'appelant (où la date est saisie = décision de modèle, cf.
 * mockups/R0C/DECISIONS-Q1.md) : ce résolveur ne la devine jamais.
 * @param {Object} ctx même contexte que duMois
 * @param {string} ym 'YYYY-MM'
 * @param {string|null} debutSuivi 'YYYY-MM-DD' ou 'YYYY-MM' (1ᵉʳ du mois). null/absent = AUCUNE borne : dû
 *        depuis l'entrée du bail.
 *        Borne posée en cours de mois (2ᵉ audit 🟠2, décision pilotage 05/10) : le dû envers le locataire
 *        commence au PREMIER TERME EXIGIBLE APRÈS la borne, jamais au prorata des jours. Le terme d'un
 *        bail à échoir commencé avant la borne était exigible avant elle (le 1ᵉʳ du mois, ou l'entrée du
 *        bail) : il revient au vendeur, ce bail ne doit rien au bailleur actuel ce mois-là. Le terme d'un
 *        bail à terme échu (`echu`) est exigible en fin de mois, après la borne : il est dû en entier.
 *        Un bail entré à la borne ou après doit son terme, proratisé à son entrée comme toujours. Le
 *        prorata vendeur/acquéreur (art. 586 C. civ., réglé chez le notaire) reste HORS de la dette.
 * @param {{segmentDebut?:string}} [opts] transmis à duMois ; `segmentDebut` désigne le bail par
 *        son entrée (un bail sorti du mois de la borne y doit 0).
 */
export function duMoisSuivi(ctx, ym, debutSuivi, opts) {
  const vide = { hc: 0, ch: 0, total: 0, source: 'vacance' };
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return vide;
  if (!debutSuivi) return duMois(ctx, ym, opts);
  const borne = String(debutSuivi).length === 7 ? String(debutSuivi) + '-01' : String(debutSuivi).slice(0, 10);
  if (String(ym) < borne.slice(0, 7)) return vide;
  if (String(ym) > borne.slice(0, 7) || borne.slice(8, 10) === '01') return duMois(ctx, ym, opts);
  // Mois de la borne, entamé : seul compte le terme exigible APRÈS elle (cf. ci-dessus). Un bail à échoir
  // entré avant la borne sort du mois ; un bail à terme échu le garde en entier s'il court encore à la
  // borne (sorti avant, son dernier terme était exigible avant elle) ; un bail entré à la borne ou après
  // est inchangé. Les baux gardés ne sont pas recadrés : leurs segments restent ceux de duMois.
  const finDe = (b) => { const e = b.finEffective || (b.archive ? b.fin : null); return e ? String(e).slice(0, 10) : null; };
  const bails = (ctx && ctx.bails || []).filter((b) => _isAlive(b) && b.debut
    && (String(b.debut).slice(0, 10) >= borne || (b.echu && (!finDe(b) || finDe(b) >= borne))));
  const seul = (opts && opts.segmentDebut) ? String(opts.segmentDebut).slice(0, 10) : null;
  if (seul && !bails.some((b) => String(b.debut).slice(0, 10) === seul)) return vide;
  return duMois(Object.assign({}, ctx, { bails }), ym, opts);
}

/** Adaptateur collections brutes → duMoisSuivi (même forme que duMoisFromRaw). */
export function duMoisSuiviFromRaw(ref, ym, raw, debutSuivi) {
  return duMoisSuivi({ ref, bails: bailsFromRaw(ref, raw), bareme: (raw && raw.bareme) || [] }, ym, debutSuivi);
}

/**
 * R0-C — segments d'occupation normalisés d'un lot (vivants, triés, TRONQUÉS C4), exposés
 * tels que duMois les voit : c'est la même définition qui borne le dû et qui rattache les
 * encaissements à un bail (Q4). Aucune seconde règle d'occupation.
 * @returns {Array<{debut:string, end:string|null, hc:number, ch:number}>}
 */
export function segmentsOccupation(bails) {
  return _occupation(bails).map((s) => ({ ...s }));
}

/**
 * Passage chronologique d'imputation des encaissements sur les dûs — MOTEUR PARTAGÉ.
 * Même algorithme que l'historique _computeLoyerArrears (cascade loyer courant → charges
 * courant → récup arriérés loyer FIFO → récup arriérés charges FIFO, files des manques
 * par mois pour le drill « cause du retard ») + option `carry` : l'excédent d'un mois
 * (avance) est REPORTÉ sur les mois suivants et couvre leurs dûs AVANT de laisser naître
 * un retard (netting avance↔retard, C2/CAS 6 — décision user 14/07). Sans `carry`,
 * comportement legacy à l'identique (consommé par _computeLoyerArrears jusqu'à l'étape 4).
 * LOT 0 « socle des dates » (CDC-LOYERS-DESIGN §4) — la cascade DÉTRUISAIT les dates :
 * `received` est un scalaire, donc aucune surface ne pouvait dire « le mois M a été soldé
 * par le mouvement du JJ/MM ». Correctif : chaque mois peut porter `sources`, la liste des
 * mouvements encaissés qui composent son `received`. Le pool scalaire est DOUBLÉ d'une file
 * de fragments FIFO (même ordre, mêmes montants) : à chaque prélèvement du scalaire on
 * prélève la même somme sur les fragments, ce qui donne `imputations[idx]` — qui a payé quoi.
 * L'arithmétique du scalaire n'est pas touchée d'un centime : les fragments ne décident rien,
 * ils suivent. Sans `sources`, un fragment anonyme (`date:null`) est créé : l'app n'invente
 * aucune date, elle dit « pas de rattachement » (I-DATE).
 *
 * @param {Array<{hcDue:number, chDue:number, received:number,
 *                sources?:Array<{date:string, id?:string, montant:number}>}>} months
 *        chronologiques (échus) ; `sources` optionnel, trié ou non (trié ici par date).
 * FINANCES-SUIVI-V2 — un mois peut aussi porter `reglement` (retenue pour loyer sur le dépôt) et `remise`
 * (manque accepté) : soldés après l'argent du mois, plafonnés, jamais une avance — la remise dans l'ordre H-1, la
 * retenue sur le LOYER HC seulement (décision Didier 17/10 : les charges vont à la régularisation). Et
 * `opts.seuilArrondi` solde en fin de mois un écart total sous le seuil (plafond cumulé), tracé `arrondi`.
 *
 * @param {{carry?:boolean, graceLast?:boolean, opening?:Object, seuilArrondi?:number}} [opts]
 */
export function _loyerArrearsPass(months, opts) {
  const carry = !!(opts && opts.carry);
  const graceLast = !!(opts && opts.graceLast);
  // FINANCES-SUIVI-V2 : seuil d'arrondi (0 = aucun, comportement historique). Le suivi passe 1 (€).
  const seuilArrondi = Math.max(0, Number(opts && opts.seuilArrondi) || 0);
  let arrondiNet = 0;
  const ms = months || [];
  // `remiseCharge` : la part d'une remise qui a soldé des CHARGES (provision remise, réputée versée à la régularisation)
  const parOrigine = { reglement: ms.map(() => 0), remise: ms.map(() => 0), remiseCharge: ms.map(() => 0), arrondi: ms.map(() => 0) };
  const lastIdx = ms.length - 1;
  const loyerQ = [], chargeQ = [];                  // files des manques : {idx, short, due, recv}
  const sumQ = (q) => q.reduce((s, e) => s + e.short, 0);
  let avanceCarry = 0;

  // C2 — POSITION D'OUVERTURE (Finances maître de l'arriéré) : une dette reportée d'avant la
  // fenêtre (arriéré des exercices antérieurs, bornée au début du suivi) est semée dans les files
  // à l'index 0. Elle est donc recouvrée EN PRIORITÉ par les premiers surplus (loyer avant charge,
  // comme un arriéré normal) et, si elle survit, attribuée au 1er mois → « Σ retardMois = arriéré
  // final » reste vrai, l'Accueil (qui lit ce total via Finances) ne ment plus sur un vieux dû.
  // Aucune imputation fiscale : c'est une dette, pas un dû/encaissement du mois (2044 en amont).
  const _open = opts && opts.opening;
  // R0-C (2ᵉ audit 🔴1) — `opening.idx` : mois où l'ouverture est posée (début du suivi dans la
  // fenêtre). Défaut 0 (début de fenêtre), comportement historique.
  const oIdx = _open ? Math.max(0, Math.min(ms.length ? ms.length - 1 : 0, Number(_open.idx) || 0)) : 0;
  // FINANCES-SUIVI-V2 : l'ouverture est posée AU MOIS `oIdx` (et non dès le 1ᵉʳ mois de la fenêtre) : la
  // position d'un mois antérieur à la date notée ne la porte pas. Résidus et soldes inchangés.
  const semerOuverture = () => {
    if (!_open) return;
    const oL = Math.max(0, Number(_open.loyer) || 0), oC = Math.max(0, Number(_open.charge) || 0);
    if (oL > 0.005) loyerQ.push({ idx: oIdx, short: oL, due: oL, recv: 0, opening: true });
    if (oC > 0.005) chargeQ.push({ idx: oIdx, short: oC, due: oC, recv: 0, opening: true });
    // AVANCE d'ouverture (trop-perçu de N-1, ex. locataire à terme échoir qui paie janvier le 28/12) :
    // portée comme avance de départ → couvre les 1ers mois dus de l'année AVANT qu'un retard naisse.
    // Sinon l'Accueil afficherait un faux impayé sur un locataire qui a payé d'avance (audit C2 #1,
    // décision CDC (b) l.136). N'a de sens qu'avec le report (carry) — la politique du maître.
    // Relecture Fable 17/10 : l'avance porte un fragment ANONYME (aucune date inventée, I-DATE) — sans lui, le mois qu'elle
    // paie n'aurait aucune imputation (la régularisation n'y verrait aucune provision versée).
    if (carry) { const oA = Math.max(0, Number(_open.avance) || 0); if (oA > 0.005) { avanceCarry += oA; frags.push({ date: null, id: null, reste: oA }); } }
  };

  // ── Traçabilité (lot 0) : le miroir en fragments du pool scalaire ──────────
  const imput = ms.map(() => []);                   // imput[idx] = [{date,id,montant,poste}]
  let frags = [];                                   // [{date,id,reste}] FIFO, le plus ancien devant
  /** Fragments d'un mois : ses `sources` (triées par date), complétées/rognées pour
   *  coller EXACTEMENT au scalaire `Math.max(0, received)` — jamais l'inverse. */
  const fragsOf = (m) => {
    const recvPos = Math.max(0, Number(m.received) || 0);
    const src = Array.isArray(m.sources) ? m.sources : null;
    const out = [];
    if (src) {
      src.slice()
        .filter((s) => s && (Number(s.montant) || 0) > 0)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        .forEach((s) => out.push({ date: s.date || null, id: (s.id != null ? s.id : null), reste: Number(s.montant) || 0 }));
    }
    let som = out.reduce((s, f) => s + f.reste, 0);
    while (som > recvPos + 0.0000001 && out.length) {  // sources > received : on rogne par la fin
      const f = out[out.length - 1];
      const t = Math.min(f.reste, som - recvPos);
      f.reste -= t; som -= t;
      if (f.reste <= 0.0000001) out.pop();
    }
    if (som < recvPos - 0.0000001) out.push({ date: null, id: null, reste: recvPos - som });
    return out;
  };
  // R0-C (2ᵉ audit 🟠3) — ce qui solde l'OUVERTURE (solde noté au début du suivi) est tracé à part :
  // ce n'est le paiement d'aucun mois suivi (une quittance ne doit jamais le dater).
  const imputOuv = [];
  /** Prélève `amt` sur les fragments (FIFO) et l'impute au mois `idx` (ou à `dest`), poste `poste`. */
  const drawTo = (idx, poste, amt, dest) => {
    let a = amt;
    while (a > 0.0000001 && frags.length) {
      const f = frags[0];
      const t = Math.min(a, f.reste);
      if (t > 0.0000001) (dest || imput[idx]).push({ date: f.date, id: f.id, montant: t, poste });
      f.reste -= t; a -= t;
      if (f.reste <= 0.0000001) frags.shift();
    }
  };
  const recover = (q, amt, poste) => {
    let a = amt;
    for (const e of q) {
      if (a <= 0.0000001) break;
      const t = Math.min(a, e.short);
      e.short -= t; a -= t;
      drawTo(e.idx, poste, t, e.opening ? imputOuv : null);
    }
  };

  const perMonth = ms.map((m, idx) => {
    if (idx === oIdx) semerOuverture();
    const hcDue = Math.max(0, Number(m.hcDue) || 0);
    const chDue = Math.max(0, Number(m.chDue) || 0);
    const recv = Number(m.received) || 0;
    const grace = graceLast && idx === lastIdx;     // mois courant sous tolérance : manque neuf non compté
    let pool = Math.max(0, recv) + (carry ? avanceCarry : 0);
    // Le miroir : sans `carry` le reliquat du mois précédent est jeté (comme le scalaire).
    frags = carry ? frags.concat(fragsOf(m)) : fragsOf(m);
    if (carry) avanceCarry = 0;
    const loyerCur = Math.min(pool, hcDue); pool -= loyerCur; drawTo(idx, 'loyer', loyerCur);
    const loyerShort = hcDue - loyerCur;
    if (loyerShort > 0.005 && !grace) loyerQ.push({ idx, short: loyerShort, due: hcDue, recv });
    const chargeCur = Math.min(pool, chDue); pool -= chargeCur; drawTo(idx, 'charge', chargeCur);
    const chargeShort = chDue - chargeCur;
    if (chargeShort > 0.005 && !grace) chargeQ.push({ idx, short: chargeShort, due: chDue, recv });
    const recL = Math.min(pool, sumQ(loyerQ)); pool -= recL; recover(loyerQ, recL, 'loyer');   // arriérés loyer (priorité)
    const recC = Math.min(pool, sumQ(chargeQ)); pool -= recC; recover(chargeQ, recC, 'charge');
    // FINANCES-SUIVI-V2 — règlements SANS virement, appliqués APRÈS l'argent du mois, dans l'ordre H-1
    // (loyer du mois → charges du mois → arriérés de loyer, plus vieux d'abord → arriérés de charges),
    // plafonnés à la dette : ils ne créent JAMAIS d'avance et ne sont jamais un encaissement (2044 intacte).
    //   `reglement` : retenue pour loyer sur le dépôt de garantie (bail sorti, décision 05/10 n° 2) ;
    //   `remise`    : manque accepté par le bailleur (décision 05/10, Q1 du 06/10).
    // Chaque somme soldée est TRACÉE SUR LE MOIS D'ORIGINE de la dette (`parOrigine`), jamais sur le mois du geste :
    // la quittance d'un mois ne peut dire « remise accordée » que pour SA dette (relecture Fable du 16/10).
    //   Décision Didier du 17/10 : la retenue sur le dépôt (`reglement`) ne règle QUE le loyer HC (loyer du mois, puis
    //   arriérés de loyer, plus vieux d'abord) — JAMAIS les charges, qui restent dues et passent par la régularisation.
    //   Le manque accepté (`remise`) et l'argent reçu gardent l'ordre H-1.
    const solder = (amt, trace, loyerSeul, traceCharge) => {
      let a = Math.max(0, Number(amt) || 0);
      if (a <= 0.005) return 0;
      const avant = a;
      const prendre = (q, courant) => {
        for (const e of q) {
          if (a <= 0.0000001) break;
          if (courant !== (e.idx === idx)) continue;
          const t = Math.min(a, e.short); e.short -= t; a -= t;
          if (t > 0 && !e.opening) { trace[e.idx] += t; if (traceCharge && q === chargeQ) traceCharge[e.idx] += t; }
        }
      };
      if (loyerSeul) { prendre(loyerQ, true); prendre(loyerQ, false); }
      else { prendre(loyerQ, true); prendre(chargeQ, true); prendre(loyerQ, false); prendre(chargeQ, false); }
      return _r2(avant - a);
    };
    solder(m.reglement, parOrigine.reglement, true);
    solder(m.remise, parOrigine.remise, false, parOrigine.remiseCharge);
    // Écart d'arrondi (décision 05/10 n° 2 : « sous 1 €, soldé d'office, trace visible ») : en fin de mois,
    // une dette ou une avance totale strictement sous le seuil est soldée, et tracée (`arrondi`, signé :
    // − = dette abandonnée, + = avance abandonnée). Plafond NET par passe : |Σ arrondis| < seuil — une avance
    // abandonnée puis une dette du même ordre se compensent (jamais 0,50 € de retard affiché pour un net nul).
    if (seuilArrondi > 0) {
      const dette = sumQ(loyerQ) + sumQ(chargeQ);
      if (dette > 0.005 && Math.abs(arrondiNet - dette) < seuilArrondi - 0.0000001) {
        const zero = (e) => { if (e.short > 0) { if (!e.opening) parOrigine.arrondi[e.idx] -= e.short; e.short = 0; } };
        loyerQ.forEach(zero); chargeQ.forEach(zero);
        arrondiNet -= dette;
      } else if (carry && dette <= 0.005 && pool > 0.005 && Math.abs(arrondiNet + pool) < seuilArrondi - 0.0000001) {
        parOrigine.arrondi[idx] += pool; arrondiNet += pool; pool = 0; frags = [];
      }
    }
    const out = { loyerArrear: _r2(sumQ(loyerQ)), chargeArrear: _r2(sumQ(chargeQ)) };
    if (carry) { avanceCarry = pool; out.avance = _r2(avanceCarry); }
    return out;
  });
  // Règlements, remises et arrondis rendus PAR MOIS D'ORIGINE (ce qu'ils ont soldé de la dette de ce mois-là).
  perMonth.forEach((out, j) => {
    const g = (k) => _r2(parOrigine[k][j]);
    if (Math.abs(g('reglement')) > 0.005) out.reglement = g('reglement');
    if (Math.abs(g('remise')) > 0.005) out.remise = g('remise');
    if (Math.abs(g('remiseCharge')) > 0.005) out.remiseCharge = g('remiseCharge');
    if (Math.abs(g('arrondi')) > 0.005) out.arrondi = g('arrondi');
  });
  const clean = (q) => q.filter((e) => e.short > 0.005).map((e) => ({ idx: e.idx, short: _r2(e.short), due: _r2(e.due), recv: _r2(e.recv) }));
  const last = perMonth.length
    ? Object.assign({}, perMonth[perMonth.length - 1], { loyerArrear: _r2(sumQ(loyerQ)), chargeArrear: _r2(sumQ(chargeQ)) })
    : { loyerArrear: 0, chargeArrear: 0 };
  // RÉSIDU par mois (colonnes P&L) : le manque ENCORE dû attribué à son mois d'origine
  // (net des rattrapages ET du netting). Invariant : Σ = arriéré final.
  const residual = (q) => { const a = ms.map(() => 0); q.forEach((e) => { if (e.short > 0.005 && e.idx >= 0 && e.idx < a.length) a[e.idx] = _r2(a[e.idx] + e.short); }); return a; };
  const loyerRes = residual(loyerQ), chargeRes = residual(chargeQ);
  const retardMois = ms.map((m, idx) => ({ loyer: loyerRes[idx], charge: chargeRes[idx] }));
  // Traçabilité : on fusionne les prélèvements successifs d'un même mouvement sur un même
  // mois/poste (la file peut être entamée en plusieurs fois), puis on trie par date.
  const imputations = imput.map((parts) => {
    const m = new Map();
    for (const p of parts) {
      if (p.montant <= 0.005) continue;
      const k = (p.id == null ? '~' : 'i' + p.id) + '|' + (p.date || '~') + '|' + p.poste;
      const prev = m.get(k);
      if (prev) prev.montant += p.montant;
      else m.set(k, { date: p.date, id: p.id, montant: p.montant, poste: p.poste });
    }
    return [...m.values()]
      .map((p) => ({ date: p.date, id: p.id, montant: _r2(p.montant), poste: p.poste }))
      .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
  });
  const res = { months: perMonth, retardMois, imputations, loyerArrear: last.loyerArrear, chargeArrear: last.chargeArrear, causeLoyer: clean(loyerQ), causeCharge: clean(chargeQ) };
  if (carry) res.avance = _r2(avanceCarry);
  // Part de l'arriéré final qui vient encore de l'OUVERTURE (le reste est né dans le suivi) : l'onglet
  // Loyers la rend à part (`etatMoisLot` → `ouverture`), datée, jamais comme la dette d'un mois.
  if (_open) {
    const oR = (q) => _r2(q.filter((e) => e.opening).reduce((t, e) => t + e.short, 0));
    res.ouvertureReste = { loyer: oR(loyerQ), charge: oR(chargeQ), idx: oIdx };
    res.imputationsOuverture = imputOuv.filter((p) => p.montant > 0.005).map((p) => ({ date: p.date, id: p.id, montant: _r2(p.montant), poste: p.poste }));
  }
  return res;
}

/**
 * Arriérés + avance d'un lot AVEC netting avance↔retard (LA politique cible des 5 surfaces,
 * étape 4). Une avance disponible couvre les mois dus suivants avant de laisser naître un
 * retard → retard>0 ET avance>0 simultanés impossibles par construction.
 * `months[].avance` = avance résiduelle APRÈS le mois (l'avance « vit » au mois qui la reçoit
 * et s'éteint au mois qui la consomme). NE CHANGE PAS l'imputation fiscale (encaissement,
 * _computeLoyerChargeAlloc) — la 2044 est en amont, intouchable.
 * @param {Array<{hcDue:number, chDue:number, received:number}>} months chronologiques (échus)
 * @param {boolean} [graceLast] neutralise le manque neuf du dernier mois (tolérance <10)
 */
export function _computeLoyerNetting(months, graceLast, opening) {
  return _loyerArrearsPass(months, { carry: true, graceLast: !!graceLast, opening: opening || null });
}
