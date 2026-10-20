/**
 * georisques-erp-detector.global.js — Wrapper browser (window.GeorisquesErpDetector)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/georisques-erp-detector.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module georisques-erp-detector — détection automatique de l'obligation
   * d'État des Risques et Pollutions (ERP / IAL) à partir de l'adresse du bien.
   * (FEAT-GEORISQUES-ERP, v15.252)
   *
   * Logique PURE et testable : construction d'URL, parsing des réponses JSON,
   * normalisation des codes INSEE d'arrondissement (Paris/Lyon/Marseille) et
   * règle de décision tri-état. L'orchestration réseau (fetch + retry) vit
   * inline dans index-test.html (I/O, non testée ici) et appelle ces fonctions.
   *
   * Sources de données (gratuites, sans clé, CORS *, appelables côté navigateur) :
   *   - BAN  : https://api-adresse.data.gouv.fr/search/  (adresse → INSEE + lon/lat)
   *   - Géorisques : https://www.georisques.gouv.fr/api/v1/  (sismique, radon, PPR)
   *
   * Règle légale (Code env. art. L.125-5 / R.125-23..27 ; décret 2022-1289) :
   * un ERP est obligatoire (annexé au bail) si la commune est couverte par un
   * PPR (naturel/technologique/minier, approuvé OU prescrit) OU si elle est en
   * zone de sismicité ≥ 2 OU en zone à potentiel radon catégorie 3.
   *
   * ⚠️ GOTCHA API (vérifié live 2026-06-02) : les endpoints gaspar/ppr* attendent
   * le paramètre `codeInsee` (camelCase). Passer `code_insee` (snake) est
   * silencieusement ignoré → l'API renvoie le dataset NATIONAL entier (HTTP 200,
   * totalElements ~6579). Tous les AUTRES endpoints utilisent `code_insee` (snake).
   *
   * ⚠️ Sécurité (mémoire « si tu ne sais pas, dis-le ») : la décision est
   * TRI-ÉTAT. On ne renvoie `false` (pas d'ERP) que si les CINQ signaux légaux
   * (sismique + radon + PPR naturel + PPR technologique + PPR minier) sont
   * définitivement connus et qu'aucun ne déclenche. Dès qu'un signal requis manque
   * (réseau, commune introuvable…) → ERP_INDETERMINE, et l'UI ne doit RIEN affirmer
   * (mention « vérifiez sur georisques.gouv.fr »).
   */

  const GEORISQUES_API = 'https://www.georisques.gouv.fr/api/v1';
  const BAN_API = 'https://api-adresse.data.gouv.fr/search';

  /** Valeur ASCII stable pour l'état « indéterminé » (évite tout souci d'encodage). */
  const ERP_INDETERMINE = 'indetermine';

  /**
   * Normalise un code INSEE d'arrondissement (Paris/Lyon/Marseille) vers le code
   * de la commune mère. Les endpoints gaspar/ppr* ne connaissent QUE la commune
   * mère (un arrondissement renvoie 0). Sismique/radon acceptent l'arrondissement.
   * @param {string} insee
   * @returns {string}
   */
  function parentInsee(insee) {
    const s = String(insee == null ? '' : insee).trim();
    if (/^751\d\d$/.test(s)) return '75056'; // Paris  (751xx)
    if (/^6938\d$/.test(s)) return '69123';  // Lyon   (6938x)
    if (/^132\d\d$/.test(s)) return '13055'; // Marseille (132xx)
    return s;
  }

  // ─── Constructeurs d'URL ──────────────────────────────────────────────────

  function banUrl(address) {
    return BAN_API + '/?q=' + encodeURIComponent(String(address == null ? '' : address).trim()) + '&limit=1';
  }

  function seismicUrl(insee) {
    return GEORISQUES_API + '/zonage_sismique?code_insee=' + encodeURIComponent(String(insee == null ? '' : insee));
  }

  function radonUrl(insee) {
    return GEORISQUES_API + '/radon?code_insee=' + encodeURIComponent(String(insee == null ? '' : insee));
  }

  function pprnUrl(insee) {
    // camelCase obligatoire (cf. GOTCHA en tête de fichier)
    return GEORISQUES_API + '/gaspar/pprn?codeInsee=' + encodeURIComponent(String(insee == null ? '' : insee));
  }

  function pprtUrl(insee) {
    return GEORISQUES_API + '/gaspar/pprt?codeInsee=' + encodeURIComponent(String(insee == null ? '' : insee));
  }

  function pprmUrl(insee) {
    return GEORISQUES_API + '/gaspar/pprm?codeInsee=' + encodeURIComponent(String(insee == null ? '' : insee));
  }

  /**
   * Lien public vers ERRIAL — service officiel de l'État des Risques réglementé
   * (à annexer au bail), sur le domaine georisques.gouv.fr.
   *
   * NB : ERRIAL est une SPA sans paramètre de pré-remplissage documenté, et les
   * anciennes routes profondes (…/connaitre-les-risques-pres-de-chez-moi/rapport2?codeInsee=…)
   * renvoient 404 / page vide en navigation directe (vérifié live 2026-06-02).
   * On renvoie donc la racine stable ; l'utilisateur y saisit l'adresse, déjà
   * affichée dans le panneau ERP. Les arguments sont conservés pour compatibilité
   * d'API mais ignorés (aucun deep-link fiable côté Géorisques).
   */
  function georisquesReportUrl(insee, lonlat) { // eslint-disable-line no-unused-vars
    return 'https://errial.georisques.gouv.fr/';
  }

  // ─── Parsers (réponses JSON → objets normalisés, ou null si indisponible) ───

  function parseBan(json) {
    const f = json && Array.isArray(json.features) ? json.features[0] : null;
    if (!f || !f.properties || !f.properties.citycode) return null;
    const p = f.properties;
    const coords = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
    return {
      insee: String(p.citycode),
      postcode: p.postcode ? String(p.postcode) : '',
      city: p.city || '',
      label: p.label || '',
      score: typeof p.score === 'number' ? p.score : null,
      lonlat: coords ? [Number(coords[0]), Number(coords[1])] : null,
    };
  }

  function parseSeismic(json) {
    const d = json && Array.isArray(json.data) ? json.data[0] : null;
    if (!d || d.code_zone == null || d.code_zone === '') return null;
    const z = Number(d.code_zone);
    if (!Number.isFinite(z)) return null;
    return { zone: z, label: d.zone_sismicite || '' };
  }

  function parseRadon(json) {
    const d = json && Array.isArray(json.data) ? json.data[0] : null;
    if (!d || d.classe_potentiel == null || d.classe_potentiel === '') return null;
    const c = Number(d.classe_potentiel);
    if (!Number.isFinite(c)) return null;
    return { category: c };
  }

  function parsePpr(json) {
    const content = json && Array.isArray(json.content) ? json.content : [];
    const total = json && typeof json.totalElements === 'number' ? json.totalElements : content.length;
    const names = content.map(c => c && (c.libPpr || c.libelle || '')).filter(Boolean);
    return { count: total, names };
  }

  // ─── Décision tri-état ──────────────────────────────────────────────────────

  /**
   * Décide si un ERP est obligatoire, à partir des signaux parsés.
   * Chaque signal est soit un objet parsé, soit `null` (indisponible).
   *
   * @param {{seismic?:object|null, radon?:object|null, pprn?:object|null, pprt?:object|null, pprm?:object|null}} inputs
   * @returns {{required: (true|false|'indetermine'), reasons: string[]}}
   */
  function decideErp(inputs) {
    const { seismic = null, radon = null, pprn = null, pprt = null, pprm = null } = (inputs || {});
    const reasons = [];
    let anyTrigger = false;

    if (pprn && pprn.count > 0) {
      anyTrigger = true;
      reasons.push(pprn.names && pprn.names.length
        ? 'PPR naturel : ' + pprn.names.join(', ')
        : 'PPR naturel (commune réglementée)');
    }
    if (pprt && pprt.count > 0) {
      anyTrigger = true;
      reasons.push(pprt.names && pprt.names.length
        ? 'PPR technologique : ' + pprt.names.join(', ')
        : 'PPR technologique');
    }
    if (pprm && pprm.count > 0) {
      anyTrigger = true;
      reasons.push(pprm.names && pprm.names.length
        ? 'PPR minier : ' + pprm.names.join(', ')
        : 'PPR minier');
    }
    if (seismic && seismic.zone >= 2) {
      anyTrigger = true;
      reasons.push('Sismicité zone ' + seismic.zone + (seismic.label ? ' (' + seismic.label + ')' : ''));
    }
    if (radon && radon.category === 3) {
      anyTrigger = true;
      reasons.push('Radon catégorie 3 (potentiel significatif)');
    }

    // Un trigger positif l'emporte toujours (sécurité : on affirme « requis »).
    if (anyTrigger) return { required: true, reasons };

    // Aucun trigger : « non requis » UNIQUEMENT si les CINQ signaux légaux sont
    // définitivement connus (sismicité + radon + PPR naturel + PPR technologique +
    // PPR minier). Sinon → indéterminé (jamais d'affirmation à l'aveugle : une commune
    // Seveso n'a parfois QU'un PPRT — l'ignorer produirait un faux « non requis »).
    // NB : une réponse API « 0 PPR » est un signal CONNU (objet {count:0}), pas null ;
    // seul un échec réseau laisse le signal à null → indéterminé.
    const haveAllPrimary = !!seismic && !!radon && !!pprn && !!pprt && !!pprm;
    if (haveAllPrimary) return { required: false, reasons: [] };
    return { required: ERP_INDETERMINE, reasons: [] };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.GeorisquesErpDetector = {
    GEORISQUES_API: GEORISQUES_API,
    BAN_API: BAN_API,
    ERP_INDETERMINE: ERP_INDETERMINE,
    parentInsee: parentInsee,
    banUrl: banUrl,
    seismicUrl: seismicUrl,
    radonUrl: radonUrl,
    pprnUrl: pprnUrl,
    pprtUrl: pprtUrl,
    pprmUrl: pprmUrl,
    georisquesReportUrl: georisquesReportUrl,
    parseBan: parseBan,
    parseSeismic: parseSeismic,
    parseRadon: parseRadon,
    parsePpr: parsePpr,
    decideErp: decideErp
  };
})(typeof window !== 'undefined' ? window : globalThis);
