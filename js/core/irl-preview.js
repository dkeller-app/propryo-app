/**
 * core/irl-preview.js — BUG-IRL-APERCU-LETTRE-V15 (Sprint 19A) v15.74
 *
 * Helpers purs (sans DB / DOM) pour le panneau "Aperçu lettre" IRL.
 * Permettent d'auto-charger la 1ʳᵉ lettre prévisualisable à l'ouverture
 * du panneau + d'alimenter un <select> de bail.
 *
 * Tests Vitest miroir : __tests__/helpers/irl-preview.test.js
 */

/**
 * Indique si une révision IRL est prévisualisable (=la lettre IRL a un sens).
 *
 * Cas NON prévisualisables :
 *  - rev === null            : pas de date de bail
 *  - rev.dpeManquant         : DPE non renseigné → pas de calcul possible
 *  - rev.gelDpeFG            : DPE F/G → loyer gelé (loi Climat 2021)
 *  - rev.insuffisant         : index IRL T-N ou T-(N-1) manquant en table
 *
 * Cas prévisualisables :
 *  - rev.pasEncoreApplicable : bail < 1 an, aperçu anticipé OK
 *  - rev calculée            : isApplicable / dejaApplique / à venir → lettre exploitable
 *
 * @param {object|null} rev sortie de computeIRLRevision()
 * @returns {boolean}
 */
export function _irlIsPreviewable(rev) {
  if (!rev) return false;
  if (rev.dpeManquant) return false;
  if (rev.gelDpeFG) return false;
  if (rev.insuffisant) return false;
  return true;
}

/**
 * Construit la liste des logements ayant une lettre IRL prévisualisable.
 * Renvoie un descriptif minimal par ref, ordonné selon l'ordre d'entrée
 * des logements (l'appelant a déjà filtré par alive + immeuble + occupé).
 *
 * @param {object[]} logements liste filtrée (alive + occupé)
 * @param {(log:object)=>object|null} computeRevisionFn callback computeIRLRevision
 * @returns {{ref:string, label:string, etat:'applique'|'applicable'|'a-venir'|'anticipe'}[]}
 */
export function _irlListPreviewableRefs(logements, computeRevisionFn) {
  if (!Array.isArray(logements) || typeof computeRevisionFn !== 'function') return [];
  const out = [];
  for (const l of logements) {
    if (!l || !l.ref) continue;
    const rev = computeRevisionFn(l);
    if (!_irlIsPreviewable(rev)) continue;
    let etat = 'applicable';
    if (rev.dejaApplique) etat = 'applique';
    else if (rev.pasEncoreApplicable) etat = 'anticipe';
    else if (rev.isApplicable === false) etat = 'a-venir';
    const loc = l.locataire ? ` — ${l.locataire}` : '';
    out.push({ ref: l.ref, label: `${l.ref}${loc}`, etat });
  }
  return out;
}

/**
 * Choisit la "meilleure" ref pour l'auto-load à l'ouverture du panneau.
 * Stratégie : priorité à une révision applicable non encore actée, sinon
 * fallback dans l'ordre : a-venir → applique → anticipe.
 *
 * @param {ReturnType<typeof _irlListPreviewableRefs>} previewables
 * @returns {string|null} la ref choisie, ou null si liste vide
 */
export function _irlPickFirstPreviewableRef(previewables) {
  if (!Array.isArray(previewables) || previewables.length === 0) return null;
  const order = ['applicable', 'a-venir', 'applique', 'anticipe'];
  for (const etat of order) {
    const found = previewables.find(p => p.etat === etat);
    if (found) return found.ref;
  }
  return previewables[0].ref;
}
