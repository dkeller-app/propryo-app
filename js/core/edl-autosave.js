/**
 * core/edl-autosave.js — l'état des lieux s'autosauve (chantier EDL TERRAIN, lot 1).
 *
 * CDC : docs/CDC-EDL.md §1 (« il n'y a pas de brouillon ») et §9, invariants 1 à 5.
 *
 * La décision, non rediscutée : dès que le logement et la date sont saisis,
 * l'EDL EXISTE dans DB.edl ; chaque saisie TERMINÉE (sortie de champ, bouton
 * d'état, ajout/suppression de photo, d'élément ou de pièce) réarme un minuteur
 * de 2 s qui appelle `saveEDL({keepOpen:true, silent:true})`. Jamais à la frappe :
 * 110 éléments × frappes = des centaines d'écritures de 49 ko.
 *
 * Ce module ne connaît ni le DOM, ni DB, ni saveEDL. Il décide QUAND écrire ;
 * l'inline fournit `save`, `isSigned` et `isReady`.
 *
 * Deux règles dures :
 *   - un EDL SIGNÉ n'est JAMAIS autosauvé (le verrou _edlIsSigned reste maître) ;
 *   - jamais plus d'une écriture par fenêtre de 2 s (invariant 4).
 */

export const EDL_AUTOSAVE_DELAY_MS = 2000;

/**
 * Faut-il écrire ? Répond à la question sans effet de bord — testable seule.
 * @param {{signed?:boolean, ready?:boolean, dirty?:boolean}} etat
 * @returns {{ok:boolean, motif:string}}
 */
export function decideAutosave({ signed = false, ready = true, dirty = true } = {}) {
  if (signed) return { ok: false, motif: 'signe' };
  if (!ready) return { ok: false, motif: 'incomplet' };
  if (!dirty) return { ok: false, motif: 'rien-a-ecrire' };
  return { ok: true, motif: 'ok' };
}

/**
 * Le minuteur d'autosave.
 *
 * @param {object} cfg
 * @param {number}   [cfg.delay]      fenêtre en ms (2 s par le CDC)
 * @param {Function} cfg.save         (motif) => void — l'écriture réelle
 * @param {Function} [cfg.isSigned]   () => bool — un EDL signé n'est jamais écrit
 * @param {Function} [cfg.isReady]    () => bool — logement + date saisis
 * @param {Function} [cfg.now]        () => ms
 * @param {Function} [cfg.setTimer]   (fn, ms) => id
 * @param {Function} [cfg.clearTimer] (id) => void
 */
export function createEdlAutosave({
  delay = EDL_AUTOSAVE_DELAY_MS,
  save,
  isSigned = () => false,
  isReady = () => true,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let timer = null;
  let dirty = false;
  const stats = { ecritures: 0, fermetures: 0, refusSigne: 0, refusIncomplet: 0, declencheurs: 0 };

  function annuler() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }

  function ecrire(motif) {
    const d = decideAutosave({ signed: !!isSigned(), ready: !!isReady(), dirty });
    if (!d.ok) {
      if (d.motif === 'signe') stats.refusSigne++;
      if (d.motif === 'incomplet') stats.refusIncomplet++;
      return d.motif;
    }
    dirty = false;
    save(motif);
    return 'ecrit';
  }

  return {
    /** Une saisie vient de se TERMINER : réarme le minuteur. */
    declencher(motif = 'saisie') {
      stats.declencheurs++;
      if (isSigned()) { stats.refusSigne++; return 'signe'; }
      dirty = true;
      // Un seul minuteur vivant à la fois : le nouveau déclencheur REMPLACE
      // l'ancien. C'est ce qui rend l'invariant 4 vrai — une écriture a lieu
      // `delay` après le DERNIER déclencheur, donc jamais deux écritures à
      // moins de `delay` l'une de l'autre.
      annuler();
      timer = setTimer(() => { timer = null; const r = ecrire(motif); if (r === 'ecrit') stats.ecritures++; }, delay);
      return 'arme';
    },

    /** Fermeture de la modale : on écrit MAINTENANT si quelque chose attend. */
    fermer(motif = 'fermeture') {
      annuler();
      const r = ecrire(motif);
      if (r === 'ecrit') stats.fermetures++;
      return r;
    },

    /** Abandonne le minuteur sans écrire (ex. l'EDL vient d'être supprimé). */
    annuler() { annuler(); dirty = false; },

    /** Un minuteur est-il armé ? */
    enAttente() { return timer !== null; },

    /** Y a-t-il une saisie non encore écrite ? */
    enRetard() { return dirty; },

    stats() { return { ...stats }; },
  };
}
