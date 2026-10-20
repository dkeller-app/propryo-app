/**
 * fil-rouge-conductor.global.js — Wrapper browser (window.FilRougeConductor)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/fil-rouge-conductor.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // Conducteur pur du fil rouge « Ajouter un bien ». AUCUNE dépendance DOM ni données.
  // Ne gère que la NAVIGATION (étapes) et le FIL D'ARIANE. La donnée vit dans DB.

  const STEPS = ['start', 'ent', 'imm', 'log', 'next', 'done', 'bail', 'transition', 'completion'];

  // Étape de départ selon le point d'entrée.
  function entryStep(kind) {
    switch (kind) {
      case 'bien': return 'start';        // porte unique : « + Ajouter un bien » ouvre le choix acte/manuel
      case 'acte': return 'log';          // acte : bailleur+immeuble pré-remplis, on confirme le lot
      case 'continue-ent': return 'imm';  // continuité après un bailleur créé hors fil
      case 'continue-imm': return 'log';  // continuité après un immeuble créé hors fil
      default: return 'ent';
    }
  }

  // Transition sur événement. Retourne l'étape suivante (ou l'étape courante si non géré).
  const _T = {
    start: { manual: 'ent' }, // « saisir à la main » ; le choix « acte » est piloté hors machine (ouvre le wizard d'import)
    ent:  { saved: 'imm' },
    imm:  { saved: 'log', back: 'ent' },
    log:  { saved: 'next', back: 'imm' },
    // Décision user 13/08 : la fin du fil MANUEL enchaîne sur la complétion (écran 'transition' →
    // accordéon), exactement comme l'import d'acte. L'ancienne sortie 'done' (« tout est déjà en
    // place ») faisait croire le bien terminé alors que 6 champs seulement avaient été saisis.
    // 'done' reste dans STEPS (compat : _frContinueTo/_frOfferContinue hors fil y mènent encore).
    next: { addLog: 'log', addImm: 'imm', finish: 'transition' },
    done: { createBail: 'bail' },
    bail: { back: 'done' },
  };
  function advance(step, event) {
    // Fil complet (post-import d'acte) : ces 2 écrans se FERMENT (null = fin du fil).
    if (step === 'transition') return event === 'continue' ? 'completion' : null;
    if (step === 'completion') return null;
    const row = _T[step];
    return (row && row[event]) || step;
  }

  // Descripteurs du fil d'Ariane (4 maillons). ctx = {step, entName, immName, lastLogRef, logCount, bailDone}
  function breadcrumb(ctx) {
    const c = ctx || {};
    const step = c.step || 'ent';
    const has = { ent: !!c.entName, imm: !!c.immName };
    const logCur = step === 'log' || step === 'next';
    const logDone = step === 'done' || step === 'bail';
    // Plusieurs logements créés : leur nombre en clair (« 4 logements »), jamais « Logt 4 +3 » (tournage 18/10).
    const logLabel = c.logCount > 1 ? c.logCount + ' logements'
      : (c.lastLogRef || 'Logement');
    return [
      { key: 'ent', icon: '👤', state: has.ent ? 'done' : ((step === 'ent' || step === 'start') ? 'cur' : 'todo'), label: c.entName || 'Bailleur' },
      { key: 'imm', icon: '🏛', state: has.imm ? 'done' : (step === 'imm' ? 'cur' : 'todo'), label: c.immName || 'Immeuble' },
      { key: 'log', icon: '🏠', state: logDone ? 'done' : (logCur ? 'cur' : 'todo'), label: logLabel },
      { key: 'bail', icon: '✍', state: c.bailDone ? 'done' : ((step === 'done' || step === 'bail') ? 'cur' : 'todo'), label: 'Bail' },
    ];
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.FilRougeConductor = {
    STEPS: STEPS,
    entryStep: entryStep,
    advance: advance,
    breadcrumb: breadcrumb
  };
})(typeof window !== 'undefined' ? window : globalThis);
