/**
 * core/sync-schedule.js — quand programmer le prochain flush cloud.
 *
 * CDC docs/CDC-EDL.md §3ter, faille F5, et §9 invariant 19j :
 *   « Hors ligne, le nombre de tentatives réseau suit le backoff — pas une par autosave. »
 *
 * Le moteur de sync sait déjà espacer ses réessais (2 s → 60 s, store-sync.js).
 * Mais `schedule()` (js/app/supabase-entry.js) efface le minuteur et replanifie à
 * 800 ms dès qu'une modification locale arrive. Avec l'autosave du lot 1, c'est
 * une modification toutes les 2 secondes : le backoff est annulé en permanence.
 * Une heure de visite hors ligne = ~1 800 requêtes qui échouent, chacune devant
 * expirer. Batterie, et indicateur qui clignote.
 *
 * La règle retenue : une modification fraîche ne peut jamais faire partir un
 * flush AVANT le plancher posé par le dernier backoff. Elle n'est pas perdue —
 * le flush qui partira au plancher couvre tout le diff, y compris elle.
 *
 * Fonction pure : pas de minuteur, pas d'horloge implicite.
 */

export const FLUSH_DEBOUNCE_MS = 800;

/**
 * @param {object} etat
 * @param {number}  etat.now            horodatage courant (ms)
 * @param {number}  [etat.delay]        délai demandé (800 ms, ou le backoff du moteur)
 * @param {boolean} [etat.isRetry]      l'appel vient du moteur après un échec
 * @param {boolean} [etat.immediate]    suppression en attente : part tout de suite
 * @param {boolean} [etat.hasTimer]     un minuteur est déjà armé
 * @param {number}  [etat.flushDueAt]   échéance de ce minuteur
 * @param {number}  [etat.backoffUntil] plancher de réessai en cours
 * @returns {{action:'run-now'|'keep'|'schedule', at:number, backoffUntil:number}}
 */
export function planFlush({
  now,
  delay = FLUSH_DEBOUNCE_MS,
  isRetry = false,
  immediate = false,
  hasTimer = false,
  flushDueAt = 0,
  backoffUntil = 0,
} = {}) {
  if (immediate) return { action: 'run-now', at: now, backoffUntil: 0 };

  if (isRetry) {
    const plancher = now + delay;
    // Un réessai ne REPOUSSE jamais un minuteur déjà plus proche (règle d'origine,
    // conservée) — mais son plancher, lui, est retenu : c'est ce qui manquait.
    if (hasTimer && flushDueAt <= plancher) {
      return { action: 'keep', at: flushDueAt, backoffUntil: Math.max(backoffUntil, plancher) };
    }
    return { action: 'schedule', at: plancher, backoffUntil: plancher };
  }

  // Modification fraîche : jamais avant le plancher du backoff en cours (F5).
  const at = Math.max(now + delay, backoffUntil);
  if (hasTimer && flushDueAt <= at) return { action: 'keep', at: flushDueAt, backoffUntil };
  return { action: 'schedule', at, backoffUntil };
}

/** Le flush a réussi : le plancher tombe (le réseau est revenu). */
export function clearBackoff() { return 0; }
