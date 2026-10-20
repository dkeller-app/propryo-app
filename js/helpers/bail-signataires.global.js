/**
 * bail-signataires.global.js — Wrapper browser (window.BailSignataires)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/bail-signataires.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/bail-signataires.js
  // Identité des signataires du bail — dérivation UNIQUE, partagée par l'orchestrateur de
  // signature (file « chacun son tour ») ET par le document (_SIGS du preview, cadres §18).
  // PUR : aucune dépendance DOM/DB. Les noms de gérants arrivent déjà résolus par
  // getBailSignataires(bail, ent) du monolithe (DRY : on ne re-parse pas ent.gerants ici).
  //
  // POURQUOI (S1 SIGNATURE-SMOKE 13/08) : ces deux dérivations vivaient en double dans
  // index.html et divergeaient quand l'entité n'a ni mandataire ni gérant (entité minimale
  // créée par le fil rouge) — la file demandait 'bailleur' pendant que le document exposait
  // 'bailleur-0' → le filtre solo du wizard ne trouvait personne → ZÉRO pad de paraphe, et
  // le bail partait « signé » sans aucune signature du bailleur.
  //
  // Règle d'or : un signataire attendu introuvable est une ERREUR EXPLICITE, jamais une
  // liste vide silencieuse.

  // Id du signataire mandataire. AUDIT 13/08 (finding critique 1) : c'était 'bailleur' (sans index),
  // alors que TOUS les consommateurs construisent leur clé par concaténation d'index —
  // genPDFNative §18 ('bailleur-'+bIdx), _footerSide (prefix+'-'+i) et buildBailleurSigIdMap.
  // Un bail signé par un mandataire sortait donc avec cadre §18 et paraphes bailleur VIDES,
  // exactement le symptôme S1/S2. Le mandataire est le signataire bailleur d'index 0.
  const ID_MANDATAIRE = 'bailleur-0';

  /**
   * Résout la liste des signataires du CÔTÉ BAILLEUR. Ne renvoie JAMAIS une liste vide.
   * @param {{names?:string[], withMandataire?:boolean, mandataireNom?:string, entityLabel?:string}} input
   *        names        — noms des gérants signataires (getBailSignataires du monolithe)
   *        withMandataire/mandataireNom — mandataire actif signant p/o le bailleur
   *        entityLabel  — nom de l'entité bailleuse (repli « entité sans gérant »)
   * @returns {Array<{id:string, nom:string, kind:'mandataire'|'gerant'|'entite'}>}
   */
  function resolveBailleurSigners(input) {
    const o = input || {};
    const mandNom = String(o.mandataireNom || '').trim();
    if (o.withMandataire && mandNom) {
      return [{ id: ID_MANDATAIRE, nom: mandNom, kind: 'mandataire' }];
    }
    const names = (Array.isArray(o.names) ? o.names : [])
      .map(n => String(n == null ? '' : n).trim())
      .filter(Boolean);
    if (names.length) {
      return names.map((nom, i) => ({ id: 'bailleur-' + i, nom, kind: 'gerant' }));
    }
    // Repli « entité sans gérant » : le bailleur signe pour lui-même. Même id que le cas
    // 1 gérant (bailleur-0) → cadres §18, ancres de relais et file de signature alignés.
    const label = String(o.entityLabel || '').trim() || 'Le bailleur';
    return [{ id: 'bailleur-0', nom: label, kind: 'entite' }];
  }

  /** Ids seuls, dans l'ordre — pour la file de signature et les clés de paraphes. */
  function bailleurSignerIds(input) {
    return resolveBailleurSigners(input).map(s => s.id);
  }

  /**
   * Signataires devant parapher la page courante du wizard, à partir de _SIGS.
   * Remplace le filtrage dispersé de _wizV2GetSigs et ajoute la garde manquante.
   * PUR et AUTONOME : sérialisée telle quelle (toString) dans la popup de signature.
   *
   * @param {Array<{id:string,role?:string}>} sigs  — _SIGS du document
   * @param {{phase2?:boolean, withLocataires?:boolean, solo?:string|null}} opts
   * @returns {{sigs:Array, error:{code:string,message:string}|null}}
   */
  function padSignersFor(sigs, opts) {
    var o = opts || {};
    var all = (sigs || []).filter(function (s) { return s && !/caution/i.test(s.role || s.id || ''); });
    var out = all;
    if (o.phase2) {
      out = out.filter(function (s) { return /^loc/i.test(s.id || ''); });
    } else if (o.withLocataires === false) {
      out = out.filter(function (s) { return /^bailleur/i.test(s.id || '') || /bailleur|gerant|gérant/i.test(s.role || ''); });
    }
    if (o.solo) {
      var solo = out.filter(function (s) { return (s.id || '') === o.solo; });
      if (!solo.length) {
        return {
          sigs: [],
          error: {
            code: 'SIGNER_INTROUVABLE',
            message: 'Signataire « ' + o.solo + ' » absent du document (signataires connus : '
              + (all.map(function (s) { return s.id; }).join(', ') || 'aucun') + ').'
          }
        };
      }
      out = solo;
    }
    if (!out.length) {
      return {
        sigs: [],
        error: { code: 'AUCUN_SIGNATAIRE', message: 'Aucun signataire attendu sur ce document — signature impossible.' }
      };
    }
    return { sigs: out, error: null };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailSignataires = {
    ID_MANDATAIRE: ID_MANDATAIRE,
    resolveBailleurSigners: resolveBailleurSigners,
    bailleurSignerIds: bailleurSignerIds,
    padSignersFor: padSignersFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
