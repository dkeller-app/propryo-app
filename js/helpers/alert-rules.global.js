/**
 * alert-rules.global.js — Wrapper browser (window.AlertRules)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/alert-rules.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module alert-rules — CATALOGUE CANONIQUE des règles d'alertes du dashboard.
   * (DRY-FACTORISATION chantier 1, v15.424 — audit 2026-07-06 : les mêmes règles métier
   * étaient réécrites 2 à 6 fois avec 3 DIVERGENCES avérées entre _computeUnifiedTodo,
   * rAlertsSection et les widgets legacy _buildWidgetV1Legacy.)
   *
   * Décisions de convergence (chaque divergence tranchée ici une fois pour toutes) :
   *  - ASSURANCE HABITATION (ex-« MRH ») manquante : la source est DB.mrh (collection dédiée),
   *    PAS DB.assurances type='MRH locataire' (l'ancienne écriture du widget, divergente).
   *  - RÉGULARISATION à émettre : sémantique du todo (clarifiée par l'utilisateur) = le logement
   *    a perçu des loyers en N-1 ET aucune régularisation n'est émise en année courante N.
   *    (L'ancien widget testait « absente en N OU N-1 » sans condition de location N-1.)
   *  - IRL : classification UNIQUE (applicable / préavis ≤45 j), toujours filtrée sur
   *    !dejaApplique (l'ancienne bannière alertes ne filtrait pas la branche applicable),
   *    avec l'état « lettre envoyée » exposé en DONNÉE (les consommateurs décident du rendu).
   *
   * Règles PURES : aucune lecture de DB/window — tout passe en argument. Les tombstones
   * (_deleted) sont filtrés ici, une fois.
   *
   * Consommé par index.html via js/helpers/alert-rules.global.js (window.AlertRules),
   * GÉNÉRÉ par tools/sync-helpers-global-mirrors.mjs — source unique, pas de copie.
   */

  const alive = x => x && !x._deleted

  // Jours calendaires entre today et une échéance — les DEUX bornes sont normalisées à minuit
  // (fix audit v15.425 mineur #4 : sans ça, une échéance du jour J n'était « expirée » qu'après
  // ~midi, selon l'heure d'exécution). Jour J → 0 (expirante, pas expirée) — sémantique du todo.
  const joursEntre = (dateIso, today) => {
    const d = dateIso instanceof Date ? new Date(dateIso.getTime()) : new Date(dateIso)
    if (isNaN(d.getTime())) return null
    const t = new Date(today.getTime())
    d.setHours(0, 0, 0, 0)
    t.setHours(0, 0, 0, 0)
    return Math.round((d - t) / 86400000)
  }

  // MATRICE-ACCUEIL (16/10) — QUELLE attestation compte pour le locataire en place :
  //  - celle du locataire PRÉCÉDENT ne compte pas : échéance antérieure à l'entrée (log.debut), ou nom différent ET
  //    enregistrée plus de 60 jours avant l'entrée (départ en cours d'année : son attestation court encore). Un nom différent
  //    seul ne suffit pas : il est figé à l'enregistrement (correction d'orthographe après l'entrée, colocataire remplacé) ;
  //  - parmi les autres, la plus récente : une attestation SANS échéance saisie après la dernière attestation datée la
  //    remplace (ni « expirée », ni « manquante ») ; sinon l'échéance la plus lointaine.
  const _creeLe = (m) => (Number(m && m.id) > 1e12 ? Number(m.id) : (Date.parse((m && m._modifiedAt) || '') || 0))
  const _ISO = /^\d{4}-\d{2}-\d{2}/
  const _nomNorm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\b(m|mme|mlle|mr|monsieur|madame|mademoiselle|et)\b/g, ' ').replace(/\s+/g, ' ').trim()
  // Même personne si l'un des noms contient tous les mots de l'autre (« Durand » / « Mme Durand », un couple / l'un des deux).
  function _memeLocataire(a0, b0) {
    const a = _nomNorm(a0), b = _nomNorm(b0)
    if (!a || !b) return true
    const ta = a.split(' '), tb = b.split(' ')
    const inclus = (x, y) => x.every(t => y.indexOf(t) >= 0)
    return inclus(ta, tb) || inclus(tb, ta)
  }
  function attestationPourLocataire(m, log) {
    if (!m || !log) return true
    const deb = _ISO.test(String(log.debut || '')) ? String(log.debut).slice(0, 10) : ''
    if (!deb) return true
    if (_ISO.test(String(m.echeance || '')) && String(m.echeance).slice(0, 10) < deb) return false
    if (!_memeLocataire(m.locataire, log.locataire)) {
      const limite = Date.parse(deb + 'T00:00:00Z') - 60 * 864e5
      if (_creeLe(m) < limite) return false
    }
    return true
  }
  function attestationCourante(mrhList, log) {
    const l = (mrhList || []).filter(alive).filter(m => m.logement === (log && log.ref) && attestationPourLocataire(m, log))
    if (!l.length) return null
    const datees = l.filter(m => _ISO.test(String(m.echeance || '')))
    const derniereDatee = datees.slice().sort((a, b) => String(b.echeance).localeCompare(String(a.echeance)))[0] || null
    const sansDate = l.filter(m => datees.indexOf(m) < 0).sort((a, b) => _creeLe(b) - _creeLe(a))[0] || null
    if (sansDate && (!derniereDatee || _creeLe(sansDate) > _creeLe(derniereDatee))) return sansDate
    return derniereDatee || sansDate
  }

  /** Assurance habitation locataire MANQUANTE (obligatoire, art. 7g loi 89-462).
   *  Source canonique : la collection mrh (PAS assurances). → [{ref, locataire}]
   *  L'attestation du locataire précédent ne compte pas (attestationPourLocataire). */
  function mrhManquante(scopeLogs, mrhList) {
    const list = (mrhList || []).filter(alive)
    return (scopeLogs || [])
      .filter(l => l && l.locataire && !attestationCourante(list, l))
      .map(l => ({ ref: l.ref, locataire: l.locataire || '' }))
  }

  /** Échéances des attestations d'assurance habitation (expirées ou < horizon jours).
   *  scopé entité via logements. → [{ref, echeance, jours, expiree}]
   *  MATRICE-ACCUEIL (16/10) — seule l'attestation COURANTE du logement compte (attestationCourante) : ajouter la
   *  nouvelle attestation (saveMrh crée une fiche à côté de l'ancienne), même sans échéance, éteint l'alerte « expirée ». */
  function mrhEcheances(mrhList, logements, activeEnt, today, horizon = 30) {
    const out = []
    const list = (mrhList || []).filter(alive)
    const logs = new Map((logements || []).filter(alive).map(l => [l.ref, l]))
    const refs = [...new Set(list.map(m => m.logement))]
    refs.map(ref => attestationCourante(list, logs.get(ref) || { ref })).forEach(m => {
      if (!m || !m.echeance) return   // attestation courante sans échéance : rien à signaler
      if (activeEnt) {
        const log = (logements || []).find(l => alive(l) && l.ref === m.logement)
        if (!log || log.entity !== activeEnt) return
      }
      const jours = joursEntre(m.echeance, today)
      if (jours == null) return
      if (jours < 0) out.push({ ref: m.logement, echeance: m.echeance, jours, expiree: true })
      else if (jours <= horizon) out.push({ ref: m.logement, echeance: m.echeance, jours, expiree: false })
    })
    return out
  }

  /** Échéances des assurances propriétaire (PNO & co), portée logement OU immeuble.
   *  → [{label, compagnie, echeance, jours, expiree}] (expirées + < horizon jours) */
  function pnoEcheances(assurances, logements, activeEnt, today, horizon = 30) {
    const out = []
    ;(assurances || []).filter(alive).forEach(a => {
      if (!a.echeance) return
      // BIENS étape 9 (décision 1 du 11/08) — plus d'alerte pour la portée IMMEUBLE : la MRO/PNO de
      // l'immeuble se renouvelle AUTOMATIQUEMENT, le rappel n'a de sens que pour l'assurance
      // habitation du LOCATAIRE (mrhEcheances, DB.mrh — non concernée). Ces assurances deviennent
      // DORMANTES : rien n'est supprimé en base, elles n'ont plus ni écran ni alerte. La branche
      // portée LOGEMENT (PNO / GLI d'un lot) reste entière — elle, reste utile.
      if (a.portee === 'immeuble') return
      if (activeEnt) {
        const log = (logements || []).find(l => alive(l) && l.ref === a.logement)
        if (!log || log.entity !== activeEnt) return
      }
      const label = a.logement
      const jours = joursEntre(a.echeance, today)
      if (jours == null) return
      if (jours < 0) out.push({ label, compagnie: a.compagnie || '', echeance: a.echeance, jours, expiree: true })
      else if (jours <= horizon) out.push({ label, compagnie: a.compagnie || '', echeance: a.echeance, jours, expiree: false })
    })
    return out
  }

  /** Classification IRL CANONIQUE d'une révision calculée (computeIRLRevision).
   *  rev déjà appliquée/renoncée, insuffisante ou pas encore applicable → null.
   *  → {etat:'applicable'|'preavis', jours, lettreEnvoyee, dateLettre, dateAnniv} */
  function irlClassifier(rev, log, today, isoLocal) {
    if (!rev || rev.insuffisant || rev.pasEncoreApplicable || rev.dejaApplique) return null
    const anniv = rev.dateRevision
    if (!anniv) return null
    const jours = joursEntre(anniv, today)
    if (jours == null) return null
    const annivIso = typeof isoLocal === 'function' ? isoLocal(anniv) : String(anniv)
    const lettreEnvoyee = !!(log && log.irlLettreEnvoyee && log.irlLettreEnvoyeePour === annivIso)
    const dateLettre = lettreEnvoyee ? (log.irlLettreEnvoyeeDate || '') : ''
    if (rev.isApplicable && rev.diff !== 0) {
      return { etat: 'applicable', jours, lettreEnvoyee, dateLettre, dateAnniv: annivIso }
    }
    if (jours >= 0 && jours <= 45) {
      return { etat: 'preavis', jours, lettreEnvoyee, dateLettre, dateAnniv: annivIso }
    }
    return null
  }

  /** Catégorie AUTO de la régularisation du SYNDIC (2044 ligne 230) — ce n'est PAS la régul du locataire. */
  const REGUL_COPRO_CAT = 'Régularisation provisions copro N-1'

  /** Régularisation de charges à émettre — sémantique canonique (clarif user) :
   *  logement avec charges, LOYERS PERÇUS en N-1, et régul N-1 NI VALIDÉE NI ÉMISE.
   *  Signaux « régul faite » (ALERTE-REGUL 14/10/2026 — aucune catégorie du référentiel ne porte la régul du
   *  locataire, son solde se range en « Charges récupérables ») :
   *   1. `estValidee(logement, annee)` — INJECTÉ par l'app : la règle vit dans js/core/regul-validation.js
   *      (validation posée sur le logement par « Valider la régul », PARTAGÉE par toute la SCI). Absent :
   *      ce signal ne compte pas (prudence : l'alerte reste) ;
   *   2. héritage : un mouvement du logement en N dont la catégorie (personnelle) contient « régularisation »,
   *      hors la catégorie automatique du syndic.
   *  → [{ref, locataire, annee (N-1), charges}] */
  function regulAEmettre(scopeLogs, mouvements, today, isLoyerCategory, estValidee) {
    const isLoyer = typeof isLoyerCategory === 'function' ? isLoyerCategory : (c => c === 'Loyers encaissés')   // NORMALISATION-LOYERS : jamais plus la catégorie héritée
    const mvs = (mouvements || []).filter(alive)
    const yrCur = today.getFullYear()
    const yrPrev = yrCur - 1
    return (scopeLogs || [])
      .filter(l => l && l.locataire && (l.ch || 0) > 0)
      .filter(l => mvs.some(m =>
        m.qui === l.ref && isLoyer(m.cat) && (m.cr || 0) > 0 &&
        m.date && m.date.startsWith(String(yrPrev))))
      .filter(l => !(typeof estValidee === 'function' && estValidee(l, yrPrev)))
      .filter(l => !mvs.some(m =>
        m.qui === l.ref && m.cat && m.cat !== REGUL_COPRO_CAT && /r.gularisation/i.test(m.cat) &&
        m.date && m.date.startsWith(String(yrCur))))
      .map(l => ({ ref: l.ref, locataire: l.locataire || '', annee: yrPrev, charges: l.ch || 0 }))
  }

  /** Baux arrivant à terme (expirés ou < horizon jours). → [{ref, locataire, fin, jours, expire}]
   *  BAUX-ECHUS — `echeanceDe(l)` (optionnel, INJECTÉ par l'app : la règle vit dans
   *  js/core/bail-echeance.js) rend l'échéance selon LA règle du type : `{ fin }` = l'échéance à
   *  venir d'un bail en cours ou reconduit (nu, meublé, garage de l'app), ou la fin du contrat d'un
   *  bail arrivé à terme (étudiant, mobilité, garage repris, autre) ; null = rien à signaler
   *  (clôturé, échéance inconnue). Sans lui : la date de fin du cache — un bail nu reconduit y
   *  apparaissait « expiré » alors que la loi le prolonge. */
  function bauxEcheance(scopeLogs, today, horizon = 90, echeanceDe) {
    const out = []
    const avecRegle = typeof echeanceDe === 'function'
    ;(scopeLogs || []).filter(l => l && l.locataire && (avecRegle || l.fin)).forEach(l => {
      let fin = l.fin
      if (avecRegle) {
        const e = echeanceDe(l)
        if (!e || !e.fin) return
        fin = e.fin
      }
      const jours = joursEntre(fin, today)
      if (jours == null) return
      if (jours < 0) out.push({ ref: l.ref, locataire: l.locataire, fin, jours, expire: true })
      else if (jours <= horizon) out.push({ ref: l.ref, locataire: l.locataire, fin, jours, expire: false })
    })
    return out.sort((a, b) => a.jours - b.jours)
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.AlertRules = {
    mrhManquante: mrhManquante,
    mrhEcheances: mrhEcheances,
    attestationCourante: attestationCourante,
    attestationPourLocataire: attestationPourLocataire,
    pnoEcheances: pnoEcheances,
    irlClassifier: irlClassifier,
    regulAEmettre: regulAEmettre,
    bauxEcheance: bauxEcheance
  };
})(typeof window !== 'undefined' ? window : globalThis);
