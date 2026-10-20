/**
 * js/core/conso-ia.js — CONSOMMATION IA : calculs PURS de l'affichage (chantier CONSO-IA, migration 0062).
 *
 * Lit ce que renvoie la base (ia_mon_usage pour l'utilisateur, ia_admin_conso pour l'administrateur) et en tire ce que
 * l'écran montre : état d'un coup d'œil, lignes par famille, gestes restants, messages de pause, synthèse admin.
 * Aucun appel réseau, aucun DOM : testé par __tests__/helpers/conso-ia.test.js. Ton neutre (ni tu ni vous).
 * Côté utilisateur : jamais d'euros. Côté administrateur : coût ESTIMÉ (grille relay/src/ai/prix.js).
 */

// Familles plafonnées (même ordre que l'écran). Unités en base : dictée en secondes, le reste à l'unité.
export const FAMILLES = Object.freeze([
  { cle: 'dictee', libelle: 'Dictée d’EDL', unite: 'min', geste: { unites: 8 * 60, un: 'EDL dicté', plusieurs: 'EDL dictés' } },
  { cle: 'pieces', libelle: 'Lecture des pièces', unite: 'pages', geste: { unites: 8, un: 'dossier candidat', plusieurs: 'dossiers candidats' } },
  { cle: 'liens', libelle: 'Locataire et artisan', unite: 'demandes', geste: null },
  { cle: 'factures', libelle: 'Lecture de factures', unite: 'lectures', geste: null },
  { cle: 'video', libelle: 'EDL filmé', unite: 'images', geste: null },
]);
// Fonctions mesurées (écran admin « Par fonction »).
export const FONCTIONS = Object.freeze([
  { cle: 'dictee', libelle: 'Dictée d’EDL' },
  { cle: 'pieces', libelle: 'Lecture des pièces' },
  { cle: 'locataire', libelle: 'Espace locataire' },
  { cle: 'artisan', libelle: 'Artisans' },
  { cle: 'factures', libelle: 'Lecture de factures' },
  { cle: 'video', libelle: 'EDL filmé' },
]);
export const SEUIL_AVERTISSEMENT = 80;
const famille = (cle) => FAMILLES.find((f) => f.cle === cle) || null;
const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plafondDe = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 2027-01-01 » → « 1er janvier » (jour 1 : « 1er »). Date illisible → « le mois prochain ». */
export function dateCourte(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return 'le mois prochain';
  const j = Number(m[3]);
  return (j === 1 ? '1er' : String(j)) + ' ' + MOIS[Number(m[2]) - 1];
}
/** « 2026-12-01 » → « Décembre 2026 ». */
export function moisLong(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const nom = MOIS[Number(m[2]) - 1];
  return nom.charAt(0).toUpperCase() + nom.slice(1) + ' ' + m[1];
}
/** Micro-euros → « 4,55 € » (deux décimales, virgule). */
export function euros(micro) {
  const v = nombre(micro) / 1e6;
  return v.toFixed(2).replace('.', ',') + ' €';
}
const entier = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Quantité affichée d'une famille (dictée : minutes arrondies au supérieur dès qu'il y a de l'usage). */
export function enAffichage(cle, unites) {
  const u = Math.max(0, nombre(unites));
  return cle === 'dictee' ? Math.ceil(u / 60) : Math.round(u);
}

/**
 * Une ligne par famille : utilisé / plafond (unités d'affichage), pourcentage, état, gestes restants.
 * état : 'sans' (pas de plafond) · 'ok' · 'proche' (≥ 80 %) · 'pause' (plafond atteint).
 * @param {{plafonds:object, unites:object}} usage
 * @param {{avecVideo?:boolean}} [opts] la vidéo n'apparaît que si elle est allumée ou déjà consommée
 */
export function lignes(usage, { avecVideo = false } = {}) {
  const p = (usage && usage.plafonds) || {};
  const u = (usage && usage.unites) || {};
  return FAMILLES.filter((f) => f.cle !== 'video' || avecVideo || nombre(u.video) > 0).map((f) => {
    const unites = Math.max(0, nombre(u[f.cle]));
    const plafond = p.sans_plafond ? null : plafondDe(p[f.cle]);
    const pct = plafond == null ? null : (plafond <= 0 ? 100 : Math.min(999, Math.round((unites / plafond) * 100)));
    const etat = plafond == null ? 'sans' : (unites >= plafond ? 'pause' : pct >= SEUIL_AVERTISSEMENT ? 'proche' : 'ok');
    let gestes = null;
    if (f.geste && plafond != null) {
      const n = Math.max(0, Math.floor((plafond - unites) / f.geste.unites));
      gestes = '≈ ' + entier(n) + ' ' + (n > 1 ? f.geste.plusieurs : f.geste.un) + ' restant' + (n > 1 ? 's' : '');
    }
    return { cle: f.cle, libelle: f.libelle, unite: f.unite, utilise: enAffichage(f.cle, unites), plafond: plafond == null ? null : enAffichage(f.cle, plafond), pct, etat, gestes };
  });
}

/** État d'un coup d'œil : la famille la plus avancée. { etat, pct, libelle } ; etat 'sans' si aucun plafond. */
export function etatGlobal(usage) {
  const ls = lignes(usage).filter((l) => l.pct != null);
  if (!ls.length) return { etat: 'sans', pct: null, libelle: null };
  const top = ls.reduce((a, b) => (b.pct > a.pct ? b : a));
  return { etat: top.etat, pct: top.pct, libelle: top.libelle, cle: top.cle };
}
/** Phrase de l'état d'un coup d'œil (Mon profil). */
export function phraseEtat(usage) {
  const e = etatGlobal(usage);
  if (e.etat === 'sans') return { etat: 'ok', titre: 'Sans plafond', texte: 'Aucun plafond ne s’applique à ce compte.' };
  if (e.etat === 'pause') return { etat: 'pause', titre: e.libelle + ' en pause', texte: 'Jusqu’au ' + dateCourte(usage && usage.renouvellement) + ' ; la saisie à la main reste disponible.' };
  const sur = e.cle === 'dictee' ? 'sur la dictée d’EDL' : 'sur « ' + e.libelle + ' »';
  if (e.etat === 'proche') return { etat: 'proche', titre: e.pct + ' % utilisés', texte: sur + ', remise à zéro le ' + dateCourte(usage && usage.renouvellement) + '.' };
  return { etat: 'ok', titre: 'Rien à signaler', texte: e.pct + ' % au plus, ' + sur + '.' };
}

/** Message d'une fonction en pause (plafond MENSUEL atteint). Jamais « bloqué » : la saisie manuelle reste. */
export function messagePause(cle, renouvellement) {
  const quand = dateCourte(renouvellement);
  switch (cle) {
    case 'dictee': return { titre: 'Dictée en pause jusqu’au ' + quand, texte: 'Le plafond mensuel de dictée de l’offre est atteint. La saisie à la main reste disponible pour toutes les pièces.' };
    case 'pieces': return { titre: 'Lecture automatique en pause jusqu’au ' + quand, texte: 'Les pièces restent consultables et vérifiables à la main ; les contrôles 2D-Doc et les indices techniques continuent.' };
    case 'factures': return { titre: 'Lecture de facture en pause jusqu’au ' + quand, texte: 'Saisir les valeurs de la facture à la main.' };
    case 'video': return { titre: 'Analyse des images en pause jusqu’au ' + quand, texte: 'La vidéo est gardée ; les photos s’ajoutent à la main.' };
    default: return { titre: 'Aide automatique en pause jusqu’au ' + quand, texte: 'La saisie à la main reste disponible.' };
  }
}
/** Ligne d'avertissement à 80 % (dictée : minutes). null sous le seuil ou sans plafond. */
export function avertissement(ligne, renouvellement) {
  if (!ligne || ligne.etat !== 'proche') return null;
  const unite = ligne.unite === 'min' ? ' min' : ' ' + ligne.unite;
  return ligne.pct + ' % ' + (ligne.cle === 'dictee' ? 'de la dictée' : 'de « ' + ligne.libelle + ' »') + ' du mois utilisés (' + entier(ligne.utilise) + ' sur ' + entier(ligne.plafond) + unite + '). Remise à zéro le ' + dateCourte(renouvellement) + '.';
}

/**
 * Synthèse de l'écran admin à partir de ia_admin_conso.
 * @returns {{mois, total, appels, actifs, jours:[{jour, cout}], fonctions:[{cle, libelle, cout, detail, off}], comptes:[…], aRegarder:[…]}}
 */
export function syntheseAdmin(data, { videoActive = false } = {}) {
  const d = data || {};
  const mois = String(d.mois || '').slice(0, 10);
  const pj = Array.isArray(d.par_jour) ? d.par_jour : [];
  const total = pj.reduce((s, x) => s + nombre(x.cout), 0);
  const appels = pj.reduce((s, x) => s + nombre(x.appels), 0);
  // Jours du mois jusqu'à aujourd'hui (mois en cours) ou jusqu'au dernier jour (mois passé), zéros compris.
  const jours = [];
  const m = /^(\d{4})-(\d{2})/.exec(mois);
  if (m) {
    const nbJours = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    const auj = String(d.aujourdhui || '');
    const dernier = auj.slice(0, 7) === mois.slice(0, 7) ? Number(auj.slice(8, 10)) : nbJours;
    const parJour = new Map(pj.map((x) => [String(x.jour).slice(0, 10), nombre(x.cout)]));
    for (let j = 1; j <= dernier; j++) { const k = mois.slice(0, 8) + String(j).padStart(2, '0'); jours.push({ jour: k, cout: parJour.get(k) || 0 }); }
  }
  const pf = new Map((Array.isArray(d.par_fonction) ? d.par_fonction : []).map((x) => [x.fonction, x]));
  const fonctions = FONCTIONS.map((f) => {
    const x = pf.get(f.cle) || {};
    const detail = f.cle === 'dictee' ? entier(Math.ceil(nombre(x.audio_sec) / 60)) + ' min · ' + entier(nombre(x.appels)) + ' appels'
      : f.cle === 'pieces' ? entier(nombre(x.pages)) + ' pages lues'
      : f.cle === 'video' ? entier(nombre(x.images)) + ' images'
      : f.cle === 'factures' ? entier(nombre(x.appels)) + ' factures'
      : entier(nombre(x.appels)) + ' demandes';
    return { cle: f.cle, libelle: f.libelle, cout: nombre(x.cout), detail, off: f.cle === 'video' && !videoActive && !nombre(x.appels) };
  });
  const comptes = (Array.isArray(d.comptes) ? d.comptes : []).map((c) => {
    const ls = lignes({ plafonds: c.plafonds, unites: c.unites }, { avecVideo: videoActive });
    const avec = ls.filter((l) => l.pct != null);
    const top = avec.length ? avec.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const pf2 = c.par_fonction || {};
    const cleTop = Object.keys(pf2).sort((a, b) => nombre(pf2[b]) - nombre(pf2[a]))[0] || null;
    const plaf = c.plafonds || {};
    return {
      userId: c.user_id, email: c.email || '(compte supprimé)', cout: nombre(c.cout), appels: nombre(c.appels),
      offre: plaf.nom || plaf.offre || '—', sansPlafond: !!plaf.sans_plafond, surcharge: !!plaf.surcharge,
      fonctionPrincipale: cleTop ? (FONCTIONS.find((f) => f.cle === cleTop) || {}).libelle || cleTop : '—',
      pct: top ? top.pct : null, etat: plaf.sans_plafond ? 'sans' : top ? top.etat : 'sans', familleMax: top ? top.libelle : null,
      lignes: ls, plafonds: plaf, surchargeDetail: c.surcharge || null,
    };
  }).sort((a, b) => b.cout - a.cout);
  const aRegarder = comptes.filter((c) => c.etat === 'pause' || c.etat === 'proche').flatMap((c) => c.lignes
    .filter((l) => l.etat === 'pause' || l.etat === 'proche')
    .map((l) => ({ userId: c.userId, email: c.email, etat: l.etat, libelle: l.libelle, pct: l.pct, utilise: l.utilise, plafond: l.plafond, unite: l.unite })))
    .sort((a, b) => (a.etat === b.etat ? b.pct - a.pct : a.etat === 'pause' ? -1 : 1));
  return { mois, total, appels, actifs: comptes.filter((c) => c.appels > 0).length, jours, fonctions, comptes, aRegarder };
}

// Coût maximal d'une unité de plafond, en micro-euros, pour la colonne « Coût max » de l'écran admin.
// Dictée et page : tirés de la grille du relais (relay/src/ai/prix.js, 0,003 $/min et 0,005 $/page à 0,87 €/$) — un test
// vérifie la cohérence. Demande du locataire ou de l'artisan (texte, 1 à 3 photos, dictée courte) et facture lue : estimations
// de la grille validée le 16/10/2026 (≈ 0,005 € et ≈ 0,001 €).
export const COUT_MAX_UNITE = Object.freeze({ dictee: 2610, pieces: 4350, liens: 5000, factures: 1000 });
/** Coût maximal d'une offre si tout le plafond est consommé (dictée en minutes). null si une famille est sans plafond. */
export function coutMaxOffre({ dictee, pieces, liens, factures } = {}) {
  const v = [dictee, pieces, liens, factures].map(plafondDe);
  if (v.some((x) => x == null)) return null;
  return v[0] * COUT_MAX_UNITE.dictee + v[1] * COUT_MAX_UNITE.pieces + v[2] * COUT_MAX_UNITE.liens + v[3] * COUT_MAX_UNITE.factures;
}
/** Gestes d'un plafond d'offre : « ≈ 11 EDL » (minutes) ou « ≈ 15 dossiers » (pages). */
export function gestesOffre(cle, valeur) {
  const v = plafondDe(valeur);
  if (v == null) return 'sans plafond';
  if (cle === 'dictee') return '≈ ' + entier(Math.floor(v / 8)) + ' EDL';
  if (cle === 'pieces') { const n = Math.floor(v / 8); return '≈ ' + entier(n) + ' dossier' + (n > 1 ? 's' : ''); }
  return '';
}

/** Valeur saisie d'un plafond : vide = sans plafond (null) ; entier 0 à 1 000 000 ; sinon invalide (undefined). */
export function lirePlafond(saisie) {
  const s = String(saisie == null ? '' : saisie).trim().replace(/\s/g, '');
  if (!s) return null;
  if (!/^\d{1,7}$/.test(s)) return undefined;
  const n = Number(s);
  return n <= 1000000 ? n : undefined;
}
