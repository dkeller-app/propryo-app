/**
 * core/irl-insee.js — CDC-QUITTANCES-IRL étape 7 (D20) : la table IRL se met à jour seule.
 *
 * Vérifié en direct le 18/08/2026 :
 *   GET https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001515333?startPeriod=YYYY-Q1
 *   · authentification : AUCUNE (l'API BDM est ouverte, l'ancien portail à jeton a fermé
 *     le 10/09/2025) ;
 *   · CORS : ouvert, préflight OPTIONS → 200. Appel DIRECT depuis le navigateur, aucun
 *     Worker relais, aucune dépendance ajoutée (règle « aucun CDN au runtime ») ;
 *   · format : SDMX XML uniquement (`Accept: application/json` est ignoré) ;
 *   · série : IDBANK 001515333 « Indice de référence des loyers », FREQ=T, base 100 = T4 1998 ;
 *   · champs utiles : TIME_PERIOD (2026-Q2), OBS_VALUE (148.37), DATE_JO (publication au
 *     Journal officiel : 2026-07-12) ;
 *   · débit : 30 appels/min. UNE lecture par ouverture d'app suffit.
 *
 * Règles d'usage (D20) :
 *   · lecture au boot, au plus UNE FOIS PAR JOUR, silencieuse ;
 *   · `IRL_DEFAULT` reste le FILET hors ligne — jamais supprimée (I12) ;
 *   · une valeur venue de l'API n'écrase JAMAIS une valeur saisie à la main : la divergence
 *     est SIGNALÉE, pas corrigée d'office (I11) ;
 *   · la date de publication au JO est affichée : c'est elle qui explique pourquoi un
 *     trimestre n'est pas encore disponible (~6 semaines après la fin du trimestre).
 *
 * Pur / testable : aucun fetch ici, aucun accès DB. L'appel réseau est fait par l'appelant
 * (index.html) et le XML arrive en argument.
 * Tests : __tests__/helpers/irl-insee.test.js
 */

/** L'IDBANK de la série IRL à l'INSEE. */
export const IRL_IDBANK = '001515333';
export const IRL_BDM_BASE = 'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/';

/** L'URL de lecture, bornée au millésime utile (on ne rapatrie pas 25 ans d'historique). */
export function urlIrlBdm(startYear) {
  const y = parseInt(startYear, 10);
  return IRL_BDM_BASE + IRL_IDBANK + (Number.isFinite(y) ? `?startPeriod=${y}-Q1` : '');
}

/** '2026-Q2' → 'T2 2026' (la clé de DB.irlTable). '' si non reconnu. */
export function cleIrl(timePeriod) {
  const m = String(timePeriod || '').match(/^(\d{4})-Q([1-4])$/);
  return m ? `T${m[2]} ${m[1]}` : '';
}

/** 'T2 2026' → '2026-Q2' (le sens inverse, pour comparer avec l'API). */
export function timePeriodDeCle(cle) {
  const m = String(cle || '').match(/^T([1-4])\s+(\d{4})$/);
  return m ? `${m[2]}-Q${m[1]}` : '';
}

/**
 * Extrait les observations d'une réponse SDMX.
 *
 * Le navigateur passe son `DOMParser` natif (conforme au CDC : zéro dépendance). En son
 * absence — Node, tests — on retombe sur une lecture d'attributs : le format SDMX de cette
 * série est plat (`<Obs TIME_PERIOD="…" OBS_VALUE="…" DATE_JO="…"/>`), et les deux chemins
 * doivent produire exactement la même chose (un test le vérifie).
 *
 * @param {string} xml
 * @param {{domParser?:{parseFromString:Function}}} [opts]
 * @returns {Array<{cle:string, timePeriod:string, valeur:number, dateJo:string}>}
 */
export function parseIrlSdmx(xml, opts) {
  const src = String(xml || '');
  if (!src.trim()) return [];
  const dp = opts && opts.domParser;
  const brut = [];
  if (dp && typeof dp.parseFromString === 'function') {
    let doc = null;
    try { doc = dp.parseFromString(src, 'application/xml'); } catch (e) { doc = null; }
    const nodes = doc && typeof doc.getElementsByTagName === 'function'
      ? doc.getElementsByTagName('Obs') : null;
    if (nodes && nodes.length) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        brut.push({
          timePeriod: n.getAttribute('TIME_PERIOD') || '',
          valeur: n.getAttribute('OBS_VALUE'),
          dateJo: n.getAttribute('DATE_JO') || ''
        });
      }
    }
  }
  if (!brut.length) {
    const re = /<Obs\b([^>]*)\/?>/g;
    let m;
    while ((m = re.exec(src))) {
      const at = m[1];
      const g = (nom) => {
        const mm = at.match(new RegExp(nom + '\\s*=\\s*"([^"]*)"'));
        return mm ? mm[1] : '';
      };
      brut.push({ timePeriod: g('TIME_PERIOD'), valeur: g('OBS_VALUE'), dateJo: g('DATE_JO') });
    }
  }
  const out = [];
  for (const o of brut) {
    const cle = cleIrl(o.timePeriod);
    const v = parseFloat(String(o.valeur).replace(',', '.'));
    if (!cle || !Number.isFinite(v)) continue;      // observation vide/annulée : ignorée
    out.push({ cle, timePeriod: o.timePeriod, valeur: Math.round(v * 100) / 100, dateJo: o.dateJo || '' });
  }
  out.sort((a, b) => a.timePeriod.localeCompare(b.timePeriod));
  return out;
}

/** D20 — au plus UNE lecture par jour. `dernierSyncIso` est horodaté en base. */
export function doitSynchroniser(dernierSyncIso, todayIso) {
  const j = String(todayIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j)) return false;
  return String(dernierSyncIso || '').slice(0, 10) !== j;
}

/**
 * I11 — LA fusion. Une valeur saisie à la main SURVIT à une synchronisation ; la divergence
 * est signalée, pas corrigée.
 *
 * Une clé est considérée SAISIE À LA MAIN si sa méta le dit (`source: 'manuel'`) ou — pour
 * les données antérieures à cette méta — si sa valeur diffère de celle d'`IRL_DEFAULT`
 * (quelqu'un l'a forcément touchée). Une clé encore égale au filet est réputée non touchée
 * et peut être rafraîchie.
 *
 * @param {Object} table    DB.irlTable — { 'T2 2026': 148.37 }
 * @param {Array}  obs      sortie de parseIrlSdmx
 * @param {{defaults?:Object, meta?:Object}} [ctx] meta = { 'T2 2026': {source, dateJo} }
 * @returns {{table:Object, meta:Object, ajouts:Array, majs:Array, divergences:Array}}
 */
export function fusionnerIrlTable(table, obs, ctx) {
  const c = ctx || {};
  const defaults = c.defaults || {};
  const metaIn = c.meta || {};
  const out = Object.assign({}, table || {});
  const meta = {};
  Object.keys(metaIn).forEach((k) => { meta[k] = Object.assign({}, metaIn[k]); });
  const ajouts = [], majs = [], divergences = [];

  for (const o of (obs || [])) {
    const k = o.cle;
    const actuel = out[k];
    const m = meta[k] || {};
    const estNombre = typeof actuel === 'number' && Number.isFinite(actuel);

    // Trimestre SUPPRIMÉ par l'utilisateur (tombstone) : on ne le ressuscite pas. Sinon le
    // bouton 🗑 de la table ne supprimerait rien de durable — il reviendrait au prochain boot.
    if (actuel && typeof actuel === 'object' && actuel._deleted) continue;

    if (!estNombre) {                       // trimestre inconnu → on l'ajoute
      out[k] = o.valeur;
      meta[k] = { source: 'insee', dateJo: o.dateJo, syncAt: c.todayIso || '' };
      ajouts.push({ cle: k, valeur: o.valeur, dateJo: o.dateJo });
      continue;
    }
    const memeValeur = Math.abs(actuel - o.valeur) < 0.005;
    // Sans méta (valeurs antérieures à cette méta), on déduit l'origine : une valeur qui
    // S'ÉCARTE du filet a forcément été touchée, et une valeur ABSENTE du filet n'a pu venir
    // que d'une saisie. Les deux sont donc protégées — sinon le trimestre saisi à la main
    // pour débloquer une révision serait écrasé au boot suivant, en silence.
    const saisieMain = m.source === 'manuel'
      || (m.source !== 'insee' && (defaults[k] == null || Math.abs(defaults[k] - actuel) >= 0.005));

    if (memeValeur) {                       // rien à faire, mais on garde la date du JO
      meta[k] = Object.assign({}, m, { dateJo: o.dateJo || m.dateJo || '', syncAt: c.todayIso || m.syncAt || '' });
      if (!meta[k].source) meta[k].source = 'insee';
      continue;
    }
    if (saisieMain) {                       // I11 : on SIGNALE, on ne corrige pas
      meta[k] = Object.assign({}, m, { source: 'manuel', dateJo: o.dateJo || m.dateJo || '', divergence: o.valeur });
      divergences.push({ cle: k, valeurLocale: actuel, valeurInsee: o.valeur, dateJo: o.dateJo });
      continue;
    }
    out[k] = o.valeur;                      // valeur encore au filet → rafraîchie
    meta[k] = { source: 'insee', dateJo: o.dateJo, syncAt: c.todayIso || '' };
    majs.push({ cle: k, avant: actuel, apres: o.valeur, dateJo: o.dateJo });
  }
  return { table: out, meta, ajouts, majs, divergences };
}

/**
 * I12 — hors ligne : la table reste ce qu'elle est, complétée du filet `IRL_DEFAULT` pour
 * les trimestres qu'elle ne connaît pas. Idempotent, jamais destructif : une clé déjà
 * présente n'est jamais remplacée par le filet.
 */
export function completerAvecFilet(table, defaults) {
  const out = Object.assign({}, table || {});
  for (const [k, v] of Object.entries(defaults || {})) {
    if (typeof out[k] !== 'number' || !Number.isFinite(out[k])) out[k] = v;
  }
  return out;
}

/** Le millésime à partir duquel il est utile d'interroger l'API (2 ans avant l'année en cours). */
export function anneeDepart(todayIso) {
  const y = parseInt(String(todayIso || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y - 2 : new Date().getFullYear() - 2;
}
