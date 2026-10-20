/**
 * dash-ctx.global.js — Wrapper browser (window.DashCtx)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/dash-ctx.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module dash-ctx — construction CANONIQUE du contexte dashboard.
   * (DRY-FACTORISATION chantier 2, v15.429 — le bloc scope+matchMv+mvs/mvsYTD/refYrMo était
   * copié-collé quasi byte-identique dans rDash et rAccueil, avec 7 lignes de logique métier
   * date+entité dupliquées. Source unique désormais, testée Vitest.)
   *
   * PUR : prend logements/mouvements + (yr, mo, activeEnt) DÉJÀ résolus par l'appelant (rDash lit
   * le <select> #dash-ent qu'il peuple ; rAccueil lit _finActiveEnt) et retourne le ctx complet.
   * Filtre les tombstones (_deleted) ici, une fois.
   *
   * Consommé par index.html via js/helpers/dash-ctx.global.js (window.DashCtx),
   * GÉNÉRÉ par tools/sync-helpers-global-mirrors.mjs — pas de copie.
   */

  const alive = x => x && !x._deleted

  /** matchMv canonique : mouvement dans la période (yr[, mo]) ET dans le scope entité.
   *  Extrait pour être réutilisé/testé isolément. */
  function makeMatchMv(activeEnt, scopeRefs, scopeImms) {
    return (m, targetYr, targetMo) => {
      const d = m.date || ''
      if (!d.startsWith(targetYr)) return false
      if (targetMo && new Date(d + 'T00:00:00').getMonth() + 1 !== parseInt(targetMo)) return false
      if (activeEnt) return scopeRefs.includes(m.qui) || scopeImms.includes(m.imm) || m.qui === 'SCI:' + activeEnt
      return true
    }
  }

  /** Construit le ctx dashboard. opts.withPrev=true ajoute mvsPrev (période précédente,
   *  mois-1 ou année-1) — sinon mvsPrev=[] (rAccueil n'en a pas besoin). */
  function buildDashCtx(logements, mouvements, yr, mo, activeEnt, opts) {
    const withPrev = !!(opts && opts.withPrev)
    const aliveLogs = (logements || []).filter(alive)
    const scopeLogs = activeEnt ? aliveLogs.filter(l => l.entity === activeEnt) : aliveLogs
    const scopeRefs = scopeLogs.map(l => l.ref)
    const scopeImms = [...new Set(scopeLogs.map(l => l.imm))]
    const matchMv = makeMatchMv(activeEnt, scopeRefs, scopeImms)
    const aliveMvs = (mouvements || []).filter(alive)
    const mvs = aliveMvs.filter(m => matchMv(m, yr, mo))
    const mvsYTD = aliveMvs.filter(m => matchMv(m, yr, ''))
    let mvsPrev = []
    if (withPrev) {
      const prevYrStr = mo && parseInt(mo) === 1 ? String(parseInt(yr) - 1) : yr
      const prevMoStr = mo ? (parseInt(mo) === 1 ? '12' : String(parseInt(mo) - 1)) : ''
      mvsPrev = mo
        ? aliveMvs.filter(m => matchMv(m, prevYrStr, prevMoStr))
        : aliveMvs.filter(m => matchMv(m, String(parseInt(yr) - 1), ''))
    }
    const refMo = mo ? parseInt(mo) : new Date().getMonth() + 1
    const refYrMo = yr + '-' + String(refMo).padStart(2, '0')
    return { scopeLogs, mvs, mvsYTD, mvsPrev, yr, mo, refYrMo, activeEnt, scopeRefs, scopeImms }
  }

  /** KPIs d'occupation d'un scope de logements — recalculés à l'identique dans 6 renders
   *  (Premium, Solo, Gestionnaire, Accueil, widget occ, _buildWidgetV1Legacy). Chantier 4. */
  function occupationKpis(scopeLogs) {
    const logs = scopeLogs || []
    const nbTotal = logs.length
    const occupied = logs.filter(l => l && l.locataire)
    const nbOcc = occupied.length
    const nbVacants = Math.max(0, nbTotal - nbOcc)
    const pctOcc = nbTotal > 0 ? Math.round(nbOcc / nbTotal * 100) : 0
    return { nbTotal, nbOcc, nbVacants, pctOcc, occupied }
  }

  /** Totaux de mouvements (crédit/débit) sur mvs + mvsYTD + mvsPrev — bloc de 6 reduces
   *  recopié dans Premium, _heroV2 et Solo. Chantier 4. */
  function mvTotals(ctx) {
    const sum = (arr, k) => (arr || []).reduce((s, m) => s + (m[k] || 0), 0)
    return {
      totalCr: sum(ctx.mvs, 'cr'), totalDb: sum(ctx.mvs, 'db'),
      prevCr: sum(ctx.mvsPrev, 'cr'), prevDb: sum(ctx.mvsPrev, 'db'),
      crYTD: sum(ctx.mvsYTD, 'cr'), dbYTD: sum(ctx.mvsYTD, 'db'),
    }
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.DashCtx = {
    makeMatchMv: makeMatchMv,
    buildDashCtx: buildDashCtx,
    occupationKpis: occupationKpis,
    mvTotals: mvTotals
  };
})(typeof window !== 'undefined' ? window : globalThis);
