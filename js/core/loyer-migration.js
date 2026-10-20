/**
 * core/loyer-migration.js — AUDIT-SUIVI-LOYERS étape 3 (2026-07-16) : reconstruire le barème de
 * loyer (DB.loyerBareme) depuis l'EXISTANT (baux + baux_historique + irlHistorique), une fois, de
 * façon déterministe et idempotente. Produit les périodes + la liste des INCOHÉRENCES à valider
 * (bandeau de l'écran « Historique du loyer »).
 *
 * Règles (§5 de l'audit — données cassées) :
 *   - IRL legacy sans `dateEffet`, au `dateRevision` = anniversaire (rétroactif = cause Fric) →
 *     re-datée selon Q1 (computeDateEffetIRL), incohérence 'irl-redatee'.
 *   - Bail archivé sans `finEffective`, chevauchant le bail suivant → tronqué à la veille (C4),
 *     incohérence 'bail-tronque'.
 *   - `log.hc` divergent du hc courant reconstruit → incohérence 'desync-hc'.
 *   - IRL sans date exploitable → ignorée du dû mais signalée 'irl-sans-date'.
 *   - Renonciation → ne coupe pas le barème (le loyer ne change pas).
 *   - Tombstones filtrés, chevauchements tronqués, prorata côté duMois().
 *
 * PUR (aucune lecture de DB), réutilise computeDateEffetIRL (Q1, DRY). Tests :
 * __tests__/helpers/loyer-migration.test.js (cas Fric canonique).
 */

import { computeDateEffetIRLHistorique as computeDateEffetIRL, _premierDuMois } from './loyer-bareme.js';   // audit M1 : l'historique se relit avec SA règle

const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _ymd = (iso) => String(iso == null ? '' : iso).slice(0, 10);
const _veille = (iso) => {
  const d = new Date(_ymd(iso) + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/** Segments d'occupation depuis les baux (vivants, triés, chevauchements tronqués). */
function _segments(bails, incoherences, ref) {
  const segs = (bails || [])
    .filter((b) => b && !b._deleted && b.debut)
    .map((b) => ({
      debut: _ymd(b.debut),
      // fin retenue : finEffective (clôture) sinon fin contractuelle pour un ARCHIVÉ, sinon ouvert
      // (bail courant, tacite reconduction). Un archivé sans aucune fin reste ouvert → tronqué ci-dessous.
      end: b.finEffective ? _ymd(b.finEffective) : (b.archive ? (b.fin ? _ymd(b.fin) : null) : null),
      hc: Number(b.hc) || 0,
      ch: Number(b.ch) || 0,
      archive: !!b.archive,
      _finSource: b.finEffective ? 'effective' : (b.fin ? 'contractuelle' : 'aucune')
    }))
    .sort((a, b) => a.debut.localeCompare(b.debut));
  // Troncature défensive : l'ancien bail s'arrête à la veille du suivant (C4 / CAS 5).
  for (let i = 0; i < segs.length - 1; i++) {
    const veille = _veille(segs[i + 1].debut);
    if (!segs[i].end || segs[i].end > veille) {
      if (segs[i].archive && segs[i]._finSource !== 'effective') {
        incoherences.push({
          type: 'bail-tronque', ref,
          debut: segs[i].debut, ancienneFin: segs[i].end, nouvelleFin: veille,
          message: `Bail archivé sans date de fin effective : tronqué au ${veille} (veille du bail suivant).`
        });
      }
      segs[i].end = veille;
    }
  }
  return segs;
}

/** Date d'effet d'une entrée IRL : `dateEffet` si présent (v15.486+), sinon re-datée Q1 (legacy). */
function _effetDeIRL(h) {
  if (h.dateEffet) return { effetIso: _ymd(h.dateEffet), redatee: false, ancien: _ymd(h.dateEffet) };
  const anniv = _ymd(h.dateRevision);
  const validation = _ymd(h.date) || anniv;
  if (!anniv && !validation) return null;
  const q1 = computeDateEffetIRL({ anniversaireIso: anniv || validation, validationIso: validation || anniv });
  return { effetIso: q1.effetIso, redatee: q1.effetIso !== anniv, ancien: anniv || validation };
}

/**
 * @param {{ref, bails:Array, irlHistorique:Array, logHc?:number}} input
 * @returns {{periodes:Array, incoherences:Array}}
 */
export function reconstruireBaremeLot(input) {
  const i = input || {};
  const ref = i.ref;
  const want = _nr(ref);
  const incoherences = [];
  const periodes = [];
  const segs = _segments(i.bails, incoherences, ref);
  if (!segs.length) return { periodes, incoherences };

  // IRL du lot (ref tolérante, tombstones + renonciations exclues du dû), triées par date d'effet.
  const irls = (i.irlHistorique || [])
    .filter((h) => h && !h._deleted && _nr(h.ref) === want && h.action !== 'renonciation')
    .map((h) => ({ h, eff: _effetDeIRL(h) }));
  for (const it of irls) {
    if (!it.eff || !it.eff.effetIso) {
      incoherences.push({ type: 'irl-sans-date', ref, message: `Révision IRL sans date exploitable (${it.h.ancienHC}→${it.h.nouveauHC}) : ignorée du barème, à corriger.` });
    }
  }
  const irlDatees = irls.filter((it) => it.eff && it.eff.effetIso).sort((a, b) => a.eff.effetIso.localeCompare(b.eff.effetIso));
  const consumed = new Set();

  for (const seg of segs) {
    // Les IRL n'affectent que le bail COURANT (actif) : un bail archivé est figé à son hc final.
    const segIrls = seg.archive ? [] : irlDatees.filter((it) => it.eff.effetIso > seg.debut && (seg.end == null || it.eff.effetIso <= seg.end));
    segIrls.forEach((it) => consumed.add(it));
    if (!segIrls.length) {
      periodes.push({ ref, debut: seg.debut, fin: seg.end, hc: seg.hc, ch: seg.ch, source: 'bail', bailDebut: seg.debut, note: '' });
      continue;
    }
    // Période initiale du bail = ANCIEN loyer (ancienHC de la 1re IRL), pas le hc courant muté.
    let curHc = Number(segIrls[0].h.ancienHC);
    if (!Number.isFinite(curHc)) curHc = seg.hc;
    let curDebut = seg.debut;
    let src = 'bail';
    let note = '';
    for (const it of segIrls) {
      const eff = it.eff.effetIso;
      periodes.push({ ref, debut: curDebut, fin: _veille(eff), hc: curHc, ch: seg.ch, source: src, bailDebut: seg.debut, note });
      if (it.eff.redatee) {
        incoherences.push({
          type: 'irl-redatee', ref,
          ancienDateEffet: it.eff.ancien, dateEffet: eff,
          ancienHC: Number(it.h.ancienHC), nouveauHC: Number(it.h.nouveauHC),
          message: `Révision IRL re-datée : effet ${it.eff.ancien} → ${eff} (1er du mois suivant la demande, jamais rétroactif). Les mois quittancés font foi.`
        });
      }
      curHc = Number(it.h.nouveauHC) || curHc;
      curDebut = eff;
      src = 'irl';
      note = it.h.irlVigueur || '';
    }
    periodes.push({ ref, debut: curDebut, fin: seg.end, hc: curHc, ch: seg.ch, source: src, bailDebut: seg.debut, note });
  }

  // IRL datées mais rattachées à AUCUNE fenêtre d'occupation (effet avant le début du bail actif,
  // ou lot entièrement archivé) : ignorées du barème → signalées plutôt que perdues en silence.
  for (const it of irlDatees) {
    if (!consumed.has(it)) {
      incoherences.push({ type: 'irl-hors-bail', ref, dateEffet: it.eff.effetIso, ancienHC: Number(it.h.ancienHC), nouveauHC: Number(it.h.nouveauHC),
        message: `Révision IRL (effet ${it.eff.effetIso}) hors de toute période de bail : ignorée du barème, à corriger.` });
    }
  }

  // Désync : le hc courant (dernière période ouverte) diverge du log.hc.
  if (i.logHc != null) {
    const ouverte = periodes.filter((p) => p.fin == null).slice(-1)[0];
    if (ouverte && Math.abs((Number(ouverte.hc) || 0) - (Number(i.logHc) || 0)) > 0.005) {
      incoherences.push({
        type: 'desync-hc', ref, logHc: Number(i.logHc) || 0, baremeHc: Number(ouverte.hc) || 0,
        message: `Loyer courant du logement (${i.logHc}) différent du barème reconstruit (${ouverte.hc}) : à trancher.`
      });
    }
  }

  return { periodes, incoherences };
}
