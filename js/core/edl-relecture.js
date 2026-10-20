/**
 * core/edl-relecture.js — la RELECTURE avant signature (chantier EDL-TÉLÉPHONE, CDC §2.7).
 *
 * Avant de signer, un aperçu en LECTURE SEULE de tout ce qui a été rempli : un bilan
 * chiffré, les lignes signalées (écarts / à constater) qu'on peut toucher pour corriger,
 * une alerte non bloquante de ce qui reste, et le contenu du pop-up « en connaissance de
 * cause ». Module PUR (ni DOM ni DB) : il compte et déduit, l'inline rend.
 *
 * Le verdict reste DÉDUIT par verdictDe() (jamais stocké ni saisi, §A.6). Les éléments
 * « Autres observations » sont des NOTES libres, sans état : ils sont exclus des comptes
 * d'état (sinon ils gonfleraient « à constater » / « non renseigné » à tort).
 */
import { verdictDe, VERDICTS, elementRenseigne } from './edl-parcours.js';

/** Un élément « Autres observations » est une note libre, pas un poste à état. */
export const estNote = (nom) => /Autres\s+observations/i.test(String(nom || ''));

/**
 * Bilan chiffré de la relecture.
 *   - sortie : { conformes, ecarts, aConstater } (verdict déduit) ;
 *   - entrée : { renseignes, nonRenseignes } (états posés).
 * Notes exclues des comptes d'état.
 */
export function bilanRelecture(pieces, isSortie) {
  let conformes = 0, ecarts = 0, aConstater = 0, renseignes = 0, nonRenseignes = 0, total = 0;
  for (const p of (pieces || [])) for (const x of ((p && p.elements) || [])) {
    if (estNote(x && x.nom)) continue;
    total++;
    if (isSortie) {
      const v = verdictDe(x && x.etatE, x && x.etatS);
      if (v === VERDICTS.CONFORME) conformes++;
      else if (v === VERDICTS.ECART) ecarts++;
      else aConstater++;
    } else {
      if (elementRenseigne(x, false)) renseignes++; else nonRenseignes++;
    }
  }
  return { isSortie: !!isSortie, total, conformes, ecarts, aConstater, renseignes, nonRenseignes };
}

/**
 * Lignes signalées EN SORTIE (écart ou à constater), pour « toucher une ligne → revenir
 * à l'élément ». Notes exclues. Ordre : pièce par pièce, élément par élément.
 * @returns {Array<{pieceIdx:number, elIdx:number, nom:string, piece:string, verdict:string}>}
 */
export function lignesSignalees(pieces) {
  const out = [];
  (pieces || []).forEach((p, pi) => ((p && p.elements) || []).forEach((x, ei) => {
    if (estNote(x && x.nom)) return;
    const v = verdictDe(x && x.etatE, x && x.etatS);
    if (v === VERDICTS.ECART || v === VERDICTS.A_CONSTATER) {
      out.push({ pieceIdx: pi, elIdx: ei, nom: (x && x.nom) || '', piece: (p && p.nom) || '', verdict: v });
    }
  }));
  return out;
}

/** Une pièce a-t-elle au moins un écart (pour l'ouvrir d'office dans l'aperçu) ? */
export function pieceAUnEcart(piece) {
  return ((piece && piece.elements) || []).some(x =>
    !estNote(x && x.nom) && verdictDe(x && x.etatE, x && x.etatS) === VERDICTS.ECART);
}

/**
 * Alertes NON BLOQUANTES à afficher avant la signature.
 * @param {Array} pieces
 * @param {boolean} isSortie
 * @param {{clesNonRendues?:number}} opts
 * @returns {string[]}
 */
export function alertesRelecture(pieces, isSortie, opts = {}) {
  const b = bilanRelecture(pieces, isSortie);
  const a = [];
  if (isSortie) {
    if (b.aConstater > 0) a.push(b.aConstater + ' élément' + (b.aConstater > 1 ? 's' : '') + ' non constaté' + (b.aConstater > 1 ? 's' : ''));
  } else if (b.nonRenseignes > 0) {
    a.push(b.nonRenseignes + ' élément' + (b.nonRenseignes > 1 ? 's' : '') + ' non renseigné' + (b.nonRenseignes > 1 ? 's' : ''));
  }
  const cle = Math.max(0, Math.trunc(Number(opts.clesNonRendues) || 0));
  if (isSortie && cle > 0) a.push(cle + ' clé' + (cle > 1 ? 's' : '') + ' non rendue' + (cle > 1 ? 's' : ''));
  return a;
}

/**
 * Contenu du pop-up de confirmation « en connaissance de cause » (CDC §2.7). Récapitule
 * écarts / non-renseignés / clés non rendues ; si tout est complet et sans écart, le
 * pop-up le dit simplement (clean).
 * @param {{ecarts?:number, nonRenseignes?:number, clesNonRendues?:number, isSortie?:boolean}} c
 * @returns {{clean:boolean, points:Array<{key:string,n:number,texte:string}>, titre:string}}
 */
export function recapSignature(c = {}) {
  const isSortie = c.isSortie !== false;
  const ecarts = Math.max(0, Math.trunc(Number(c.ecarts) || 0));
  const nonR = Math.max(0, Math.trunc(Number(c.nonRenseignes) || 0));
  const cle = Math.max(0, Math.trunc(Number(c.clesNonRendues) || 0));
  const points = [];
  if (isSortie && ecarts > 0) points.push({ key: 'ecarts', n: ecarts, texte: ecarts + ' écart' + (ecarts > 1 ? 's' : '') + ' constaté' + (ecarts > 1 ? 's' : '') + ' par rapport à l\'entrée' });
  // Sortie : le compte est celui des « à constater » → on dit « non constaté(s) », comme la bannière
  // (alertesRelecture). Entrée : ce sont les champs vides → « non renseigné(s) ». Même concept, même mot.
  if (nonR > 0) points.push({ key: 'nonRenseignes', n: nonR, texte: nonR + ' élément' + (nonR > 1 ? 's' : '') + (isSortie ? (' non constaté' + (nonR > 1 ? 's' : '')) : (' non renseigné' + (nonR > 1 ? 's' : ''))) });
  if (isSortie && cle > 0) points.push({ key: 'cles', n: cle, texte: cle + ' clé' + (cle > 1 ? 's' : '') + ' non restituée' + (cle > 1 ? 's' : '') });
  const clean = points.length === 0;
  return { clean, points, titre: clean ? 'Confirmer la signature' : 'Avant de signer' };
}
