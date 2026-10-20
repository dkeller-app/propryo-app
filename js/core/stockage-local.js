/**
 * core/stockage-local.js — le REGISTRE du stockage local et les trois gestes
 * qu'il autorise (CDC docs/CDC-STOCKAGE.md, lot 1).
 *
 * ═══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════
 * Incident du 28/08 : « Mémoire pleine, cette modification n'est PAS
 * enregistrée ». Le miroir de la base (~50 Ko à 2 Mo) ne passait plus parce
 * que le `localStorage` de l'origine (~5 Mo) était rempli par des COPIES
 * COMPLÈTES de la base que rien ne retirait jamais : sauvegardes avant
 * migration datées, sauvegarde « avant sync » de l'ancien Drive, sauvegarde de
 * base corrompue. Aucune règle d'occupation, aucune éviction.
 *
 * Ce module pose la règle. Chaque clé connue de l'app a une CLASSE ; seules
 * deux classes sont jetables :
 *   - `copie`   : une copie complète de la base (jamais légitime en localStorage) ;
 *   - `retiree` : une clé que plus aucun code n'écrit ni ne lit.
 * Tout le reste est protégé, et une clé que le registre ne reconnaît pas est
 * INTOUCHABLE : l'origine github.io est partagée avec d'autres pages (S-4).
 *
 * Les trois gestes (tous sur un `storage` INJECTÉ → testables sans navigateur) :
 *   1. `ecrireAvecLiberation` — le save sacré (S-1) : sur refus de quota,
 *      libère les clés jetables puis réessaie UNE fois ;
 *   2. `nettoyer`             — au démarrage, retire toutes les clés jetables
 *      (S-5 : les comptes existants se réparent sans console) ;
 *   3. `purgerCopies`         — à la déconnexion, retire les copies (S-7, RGPD).
 *
 * Aucune API navigateur n'est appelée ici en dehors du `storage` reçu.
 */

// Les clés du miroir et de la session. Constantes LOCALES, volontairement, sans import :
// js/main.js importe ce module STATIQUEMENT ; un import de offline-boot.js ou de cache-purge.js
// ici rendrait TOUT main.js (et ses ~40 exports vers l'app) dépendant de ces deux fichiers — un
// seul des deux en 404 et main.js entier ne se charge plus (constaté au ré-audit du lot 1, même
// cause que la régression de l'écran de connexion). Égalité avec les exports de offline-boot.js et
// cache-purge.js verrouillée par __tests__/helpers/stockage-local.test.js.
export const MIROIR_KEY = 'immotrack_v4';
export const MIROIR_ECRIT_KEY = 'immotrack_v4_ecrit_at';
export const FLUSH_OK_KEY = 'immotrack_v4_flush_at';
export const ESPACES_KEY = 'immotrack_v4_espaces';
export const MIRROR_TAG_KEY = 'immotrack_v4_tag';
export const AUTH_STORAGE_KEY = 'immo-supabase-auth';
/** Les écritures hors ligne que F1 remonte au cloud — PROPRIÉTAIRE : offline-boot.js
 *  (ECRITURES_REMONTEES_PAR_F1). Copie locale pour la même raison que les clés ci-dessus (pas d'import
 *  dans un module chargé statiquement par main.js) ; égalité verrouillée par stockage-local.test.js. */
export const ECRITURES_REMONTEES_PAR_F1 = Object.freeze(['edl', 'edl-photo', 'edl-signature-presentielle']);

const echap = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Clé exacte, en prod seulement (clés écrites sans `_lsKey`). */
const exacte = k => new RegExp('^' + echap(k) + '$');
/** Clé exacte, dans tous les namespaces (clés écrites via `_lsKey` : `_test_` en sandbox, `_demo_` en démonstration ?demo=1). */
const deuxNs = k => new RegExp('^(_test_|_demo_)?' + echap(k) + '$');
/** Préfixe, dans tous les namespaces (le suffixe porte un libellé ou une date). */
const prefixe = k => new RegExp('^(_test_|_demo_)?' + echap(k) + '.+$');

/**
 * Le registre. L'ORDRE COMPTE : la première règle qui reconnaît la clé
 * l'emporte (`immotrack_v4_corrupt_backup_*` doit être vue comme copie avant
 * que `immotrack_v4_*` ne soit examinée). `exemples` sert aux tests.
 */
export const REGISTRE = [
  // ── copies complètes de la base — jetables, et interdites en localStorage (S-2)
  { motif: prefixe(MIROIR_KEY + '_corrupt_backup_'), classe: 'copie', note: 'base illisible sauvegardée par initDB (legacy)', exemples: ['immotrack_v4_corrupt_backup_1714000000000'] },
  { motif: prefixe('immotrack_backup_'), classe: 'copie', note: '_backupBeforeMigration (avant lot 1)', exemples: ['immotrack_backup_archi-v1_2026-05-02', '_test_immotrack_backup_archi-v4b_2026-05-20'] },
  { motif: exacte('_driveBackupBeforeSync'), classe: 'copie', note: 'ancien Drive, retiré en v15.351', exemples: ['_driveBackupBeforeSync'] },

  // ── la base et son état
  { motif: deuxNs(MIROIR_KEY), classe: 'principal', note: 'miroir / base legacy (KEY)', exemples: ['immotrack_v4', '_test_immotrack_v4'] },
  // STOCKAGE lot 4 — journal SYNCHRONE des EDL pas encore engagés dans le miroir IndexedDB
  // (js/core/miroir-local.js). Donnée vivante (zéro perte d'EDL hors ligne) : jamais évinçable.
  { motif: exacte(MIROIR_KEY + '_edl_attente'), classe: 'principal', note: 'journal des EDL non engagés en IndexedDB (lot 4)', exemples: ['immotrack_v4_edl_attente'] },
  { motif: exacte(MIROIR_KEY + '_copie_incomplete'), classe: 'etat', note: 'copie hors ligne incomplète (lot 4, repli protégé)', exemples: ['immotrack_v4_copie_incomplete'] },
  { motif: deuxNs(MIROIR_ECRIT_KEY), classe: 'etat', note: 'dernière écriture réussie du miroir (F1)', exemples: ['immotrack_v4_ecrit_at', '_test_immotrack_v4_ecrit_at'] },
  { motif: exacte(FLUSH_OK_KEY), classe: 'etat', note: 'dernier flush cloud réussi (F1)', exemples: ['immotrack_v4_flush_at'] },
  { motif: exacte(ESPACES_KEY), classe: 'etat', note: 'espaces autorisés hors ligne', exemples: ['immotrack_v4_espaces'] },
  { motif: exacte(MIRROR_TAG_KEY), classe: 'etat', note: 'propriétaire du miroir (RGPD)', exemples: ['immotrack_v4_tag'] },
  { motif: deuxNs('immotrack_archi_v1_done'), classe: 'etat', note: 'marqueur de migration', exemples: ['immotrack_archi_v1_done'] },
  // COMPTE DÉMO (?demo=1 ; aussi le bouton du sandbox pour demo_charge) : jeu de données déjà chargé, et le nuage FICTIF
  // de la démo (espace locataire, liens d'artisan) tenu en local : plan à semer, puis tables simulées. Jamais en prod.
  { motif: deuxNs('demo_charge'), classe: 'etat', note: 'jeu de données démo déjà chargé', exemples: ['_demo_demo_charge', '_test_demo_charge'] },
  { motif: deuxNs('demo_nuage_plan'), classe: 'etat', note: 'démonstration : plan du nuage fictif à semer', exemples: ['_demo_demo_nuage_plan'] },
  { motif: deuxNs('demo_nuage'), classe: 'etat', note: 'démonstration : nuage fictif (tables simulées, local)', exemples: ['_demo_demo_nuage'] },
  { motif: deuxNs('immotrack_archi_v4b_done'), classe: 'etat', note: 'marqueur de migration', exemples: ['immotrack_archi_v4b_done'] },
  { motif: deuxNs('immo_appareil_id'), classe: 'etat', note: 'identité de l’appareil (EDL)', exemples: ['immo_appareil_id'] },
  { motif: exacte('immo_backup_lastAt'), classe: 'etat', note: 'sauvegarde de sécurité : dernière réussite', exemples: ['immo_backup_lastAt'] },
  { motif: exacte('immo_backup_reminder_at'), classe: 'etat', note: 'rappel de sauvegarde', exemples: ['immo_backup_reminder_at'] },
  { motif: exacte('immo_backup_reminder_off'), classe: 'etat', note: 'rappel de sauvegarde désactivé', exemples: ['immo_backup_reminder_off'] },
  { motif: exacte('immo_fullapp_once'), classe: 'etat', note: 'ouverture unique de l’app complète', exemples: ['immo_fullapp_once'] },
  { motif: exacte('propryo_pwa_refus'), classe: 'etat', note: 'invitation à installer refusée', exemples: ['propryo_pwa_refus'] },
  // EDL-VOIX-IA — dernier statut connu de l'IA (dictée proposée hors ligne) et notice déjà lue.
  { motif: deuxNs('propryo_ia_actif'), classe: 'etat', note: 'IA de dictée active (dernier statut connu)', exemples: ['propryo_ia_actif', '_test_propryo_ia_actif'] },
  { motif: deuxNs('propryo_ia_notice'), classe: 'etat', note: 'notice de la dictée IA déjà lue', exemples: ['propryo_ia_notice', '_test_propryo_ia_notice'] },
  // EDL-VIDEO-IA — dernier statut connu de la vidéo (« Filmer la pièce » proposé hors ligne si le relais l'a ouverte).
  { motif: deuxNs('propryo_ia_video'), classe: 'etat', note: 'état des lieux filmé ouvert (dernier statut connu)', exemples: ['propryo_ia_video', '_test_propryo_ia_video'] },
  // CANDIDATURES-CONFORMITE : chemins en ligne de pièces de candidats supprimées hors ligne, à effacer au retour (RGPD).
  { motif: deuxNs('imsb-cand-purge-attente'), classe: 'etat', note: 'fichiers en ligne de candidats à effacer (reprise hors ligne)', exemples: ['imsb-cand-purge-attente', '_test_imsb-cand-purge-attente'] },
  // ESPACE LOCATAIRE (0059) : signalements réservés par cet appareil, pas encore enregistrés au registre (reprise).
  { motif: deuxNs('imsb-el-imports-en-cours'), classe: 'etat', note: 'signalements de l’espace locataire en cours d’import (reprise)', exemples: ['imsb-el-imports-en-cours', '_test_imsb-el-imports-en-cours'] },
  // Audit d'intégration v15.728 🟠2 — purges de sessions de signature à retenter : CET appareil seulement (le jeton du relais ne
  // part jamais dans les archives synchronisées du bail). Donnée vivante : jamais évinçable.
  { motif: deuxNs('immotrack_rs_purges'), classe: 'etat', note: 'sessions de signature archivées à supprimer du relais (nouvel essai)', exemples: ['immotrack_rs_purges', '_test_immotrack_rs_purges'] },
  { motif: exacte('imsb-doc-express'), classe: 'etat', note: 'document express venu de propryo.fr, en attente de l’inscription (30 min)', exemples: ['imsb-doc-express'] },

  // ── session
  { motif: new RegExp('^' + echap(AUTH_STORAGE_KEY) + '(-code-verifier)?$'), classe: 'session', note: 'jeton de session (PWA)', exemples: [AUTH_STORAGE_KEY, AUTH_STORAGE_KEY + '-code-verifier'] },

  // ── préférences d'écran (par appareil)
  ...['immotrack_active_entity', 'immo_menu_on', 'immo_fav_bar', 'immo_nav_open', 'immotrack_sb_collapsed',
    'immotrack_sb_sections_collapsed', 'immotrack_fontsize', 'immotrack_theme_mode', 'immotrack_theme',
    'immotrack_biens_view', 'immotrack_biens_tab', 'immBlocksCollapsed', 'locImmBlocksCollapsed',
    'logGroupsCollapsed', 'RELAY_BASE',
  ].map(k => ({ motif: deuxNs(k), classe: 'pref', note: 'préférence d’écran', exemples: [k, '_test_' + k] })),
  ...['immo_backup_freq', 'immo_theme'].map(k => ({ motif: exacte(k), classe: 'pref', note: 'préférence', exemples: [k] })),
  // FINANCES-SUIVI-V2 : alerte de Mouvements masquée par la croix (par appareil, commodité d'écran).
  { motif: prefixe('fin-alerte-vue:'), classe: 'pref', note: 'alerte de Mouvements masquée (virement entre deux locataires, manque)', exemples: ['fin-alerte-vue:q3:123', '_test_fin-alerte-vue:manque:123'] },

  // ── secret résiduel : reconnu, mais HORS LOT 1 (signalé à part) — ni évincé ni nettoyé
  { motif: deuxNs('RELAY_APP_KEY'), classe: 'secret_residuel', note: 'ancienne clé du relais de signature (retirée) — traitement hors lot', exemples: ['RELAY_APP_KEY', '_test_RELAY_APP_KEY'] },

  // ── clés retirées : plus aucun code ne les écrit ni ne les lit — jetables
  ...['_driveBackupBeforeSyncAt', '_driveGlobalFileId', '_driveLastSync', '_myGlobalFileId', '_myEntityFileIds',
    '_drvSharedRootId', '_drvSharedRootName', '_drvInstallId', '_drvAutoDetectDismissed', '_driveModalDismiss',
    'immo_use_supabase',
  ].map(k => ({ motif: exacte(k), classe: 'retiree', note: 'ancien Drive / bi-mode', exemples: [k] })),
  ...['irl_view', 'irl_grp_collapsed', 'quit_view', 'dash_alerts_collapsed',
  ].map(k => ({ motif: deuxNs(k), classe: 'retiree', note: 'ancienne préférence d’écran', exemples: [k, '_test_' + k] })),
];

const JETABLES = new Set(['copie', 'retiree']);

/** Classe d'une clé : 'principal' | 'etat' | 'session' | 'pref' | 'copie' | 'retiree' | 'secret_residuel' | 'inconnue'. */
export function classerCle(cle) {
  if (typeof cle !== 'string' || !cle) return 'inconnue';
  for (const r of REGISTRE) if (r.motif.test(cle)) return r.classe;
  return 'inconnue';
}

/** D5 A : seules les copies complètes connues et les clés retirées peuvent partir. */
export function estEvincable(cle) { return JETABLES.has(classerCle(cle)); }

/** Poids d'une entrée dans l'unité du quota Chromium : caractères UTF-16, clé + valeur. */
export function tailleStockage(cle, valeur) {
  return String(cle == null ? '' : cle).length + (valeur == null ? 0 : String(valeur).length);
}

/** Le navigateur refuse-t-il l'écriture faute de place ? (Chromium, Firefox, Safari) */
export function estQuotaDepasse(e) {
  if (!e) return false;
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22 || e.code === 1014) return true;
  return /quota/i.test(String(e.message || ''));
}

/** Toutes les clés présentes (tolérant : un stockage illisible rend []). */
export function lireCles(storage) {
  const out = [];
  try {
    const n = storage.length;
    for (let i = 0; i < n; i++) { const k = storage.key(i); if (k != null) out.push(k); }
  } catch (_e) { return []; }
  return out;
}

/** [{ cle, taille }] pour chaque clé présente. (Lit TOUTES les valeurs : diagnostic seulement.) */
export function lireEntrees(storage) {
  return entreesDe(storage, lireCles(storage));
}

/**
 * [{ cle, taille }] des seules clés JETABLES. Les clés sont filtrées AVANT toute lecture : ni le
 * miroir (jusqu'à plusieurs Mo), ni les préférences, ni les clés d'autres pages de l'origine ne
 * sont lus — le chemin du save sur quota ne paie que ce qu'il peut libérer.
 */
export function lireEntreesJetables(storage) {
  return entreesDe(storage, lireCles(storage).filter(estEvincable));
}

function entreesDe(storage, cles) {
  const out = [];
  for (const cle of cles) {
    let v = null;
    try { v = storage.getItem(cle); } catch (_e) { v = null; }
    out.push({ cle, taille: tailleStockage(cle, v) });
  }
  return out;
}

/**
 * Plan de libération : copies par taille décroissante, puis clés retirées par
 * taille décroissante. Rien d'autre (D5 A). Toutes les jetables partent : elles
 * sont mortes, et un demi-nettoyage laisserait le prochain save au bord du vide.
 */
export function planLiberation(entrees) {
  const liste = Array.isArray(entrees) ? entrees.filter(e => e && estEvincable(e.cle)) : [];
  const rang = e => (classerCle(e.cle) === 'copie' ? 0 : 1);
  return liste
    .slice()
    .sort((a, b) => rang(a) - rang(b) || (b.taille || 0) - (a.taille || 0))
    .map(e => e.cle);
}

/**
 * Supprime une liste de clés (appelée UNIQUEMENT avec des clés jetables) ; rend le nombre de
 * caractères libérés. `tailles` (Map clé → taille) évite de relire une valeur déjà mesurée.
 */
function supprimer(storage, cles, tailles) {
  let caracteres = 0;
  const faites = [];
  for (const cle of cles) {
    let t = tailles && tailles.has(cle) ? tailles.get(cle) : null;
    if (t == null) {
      let v = null;
      try { v = storage.getItem(cle); } catch (_e) { v = null; }
      t = tailleStockage(cle, v);
    }
    try { storage.removeItem(cle); faites.push(cle); caracteres += t; } catch (_e) { /* on continue */ }
  }
  return { faites, caracteres };
}

/**
 * S-1 — LE SAVE SACRÉ. Écrit les paires [clé, valeur] dans l'ordre. Sur refus de
 * quota : libère les clés jetables, puis réessaie TOUTES les paires une seule
 * fois (pas de boucle). Toute autre erreur est rendue telle quelle, sans
 * éviction. Ne lève jamais.
 *
 * @returns {{ ok:boolean, liberees:string[], caracteresLiberes:number, erreur:any }}
 */
export function ecrireAvecLiberation(storage, paires) {
  const ecrire = () => { for (const [k, v] of paires) storage.setItem(k, v); };
  try {
    ecrire();
    return { ok: true, liberees: [], caracteresLiberes: 0, erreur: null };
  } catch (e) {
    if (!estQuotaDepasse(e)) return { ok: false, liberees: [], caracteresLiberes: 0, erreur: e };
    const entrees = lireEntreesJetables(storage);          // seules les valeurs jetables sont lues
    const plan = planLiberation(entrees);
    if (!plan.length) return { ok: false, liberees: [], caracteresLiberes: 0, erreur: e };
    const { faites, caracteres } = supprimer(storage, plan, new Map(entrees.map(x => [x.cle, x.taille])));
    try {
      ecrire();
      return { ok: true, liberees: faites, caracteresLiberes: caracteres, erreur: null };
    } catch (e2) {
      return { ok: false, liberees: faites, caracteresLiberes: caracteres, erreur: e2 };
    }
  }
}

/** S-5 — les clés que le nettoyage de démarrage retire (toutes les jetables présentes). */
export function clesDuNettoyage(cles) {
  return (Array.isArray(cles) ? cles : []).filter(estEvincable);
}

/** S-5 — nettoyage de démarrage, idempotent. Ne lève jamais. */
export function nettoyer(storage) {
  const { faites, caracteres } = supprimer(storage, clesDuNettoyage(lireCles(storage)));
  return { supprimees: faites, caracteres };
}

/** S-7 — les copies complètes de la base présentes (à purger au logout / changement d'utilisateur). */
export function clesCopiesLocales(cles) {
  return (Array.isArray(cles) ? cles : []).filter(k => classerCle(k) === 'copie');
}

/** S-7 — purge des copies. Rend les clés supprimées. Ne lève jamais. */
export function purgerCopies(storage) {
  return supprimer(storage, clesCopiesLocales(lireCles(storage))).faites;
}

// ── STOCKAGE lot 3 — le message vrai (S-6, D1 B) et l'état de la copie de cet appareil (§3.7) ──

/** Les textes (maquette validée par Didier le 06/10, mockups/STOCKAGE/reglages-etat-stockage.html ;
 *  `edl`, `reseauCoupe`, `sessionMorte` ajoutés au contre-audit du lot 3, même registre).
 *  `enLigne` est donné au moment où l'envoi est MARQUÉ, pas quand le cloud l'a reçu : il dit « part au
 *  cloud », jamais « bien enregistrée dans le cloud » (audit lots 2-3, 🟡1 — D1 B inchangé : jamais
 *  « PAS enregistrée » en ligne). */
export const TEXTES_ECHEC_MIROIR = {
  enLigne: 'Copie de secours de cet appareil non mise à jour. La modification part au cloud ; '
    + 'sans réseau, cet appareil afficherait des données plus anciennes. Détail : Sauvegarde & export → Stockage de cet appareil.',
  edl: 'Stockage de cet appareil plein : cet état des lieux n’est pas encore en sécurité sur l’appareil. '
    + 'Il part au cloud ; garder l’application ouverte jusqu’à la fin de l’envoi.',
  reseauCoupe: 'Stockage de cet appareil plein et réseau coupé : cette modification n’est pas encore en sécurité. '
    + 'Garder l’application ouverte jusqu’au retour du réseau pour qu’elle parte au cloud.',
  sessionMorte: 'Stockage de cet appareil plein et session expirée : cette modification n’est PAS enregistrée. Se reconnecter, puis la refaire.',
  edlHorsLigne: 'Stockage de cet appareil presque plein : cet état des lieux est enregistré sur cet appareil. '
    + 'Il partira au cloud au retour du réseau, en rouvrant Propryo. Détail : Sauvegarde & export → Stockage de cet appareil.',
  horsLigne: 'Stockage de cet appareil plein : cette modification n’est PAS enregistrée. La refaire une fois le réseau revenu.',
  sandbox: 'Stockage de cet appareil plein : cette modification n’est PAS enregistrée. Vider la base de test pour libérer de la place.',
  local: 'Stockage de cet appareil plein : cette modification n’est PAS enregistrée.',
};

const estEdl = quoi => typeof quoi === 'string' && /^edl(-|$)/.test(quoi);
/** Hors ligne : seules ces écritures remontent au cloud par F1 (offline-boot, ECRITURES_REMONTEES_PAR_F1). */
const remonteeParF1 = quoi => ECRITURES_REMONTEES_PAR_F1.indexOf(String(quoi || '')) >= 0;

/**
 * S-6 / D1 B — que dire, et que rendre, quand la copie de cet appareil (le miroir) n'a pas pu être écrite ?
 * Le retour de saveDB dit si la modification a une DESTINATION DURABLE :
 *   - `cloud-en-ligne` : le cloud la reçoit (sync marquée quoi qu'il arrive) → `true`, avis UNIQUE par
 *     session (la copie de l'appareil est en retard). EXCEPTION, l'état des lieux : sa copie locale est son
 *     second filet (F1 le remonte au démarrage suivant) ; un envoi encore en mémoire n'est pas durable. Il
 *     n'est « enregistré » que si l'écriture IndexedDB est planifiée (`miroirIdb`) — sinon `false`, avis
 *     unique « pas encore en sécurité » (contre-audit lot 3, B1) ;
 *   - `cloud-reseau-coupe` (session en ligne, `navigator.onLine` faux) : rien n'est durable, la modification
 *     reste en mémoire et partira au retour du réseau si l'app reste ouverte → `false` ;
 *   - `cloud-session-morte` : plus rien ne part au cloud → `false`, « PAS enregistrée » ;
 *   - `cloud-hors-ligne`, `local` (sandbox, ancien mode) : le miroir était la seule destination → `false`.
 *     EXCEPTION, l'état des lieux HORS LIGNE (écritures REMONTÉES PAR F1 seulement : `edl`, `edl-photo`,
 *     `edl-signature-presentielle` — pas `edl-pieces`, gabarit du logement) dont l'écriture IndexedDB est
 *     planifiée (`miroirIdb`) : seul
 *     un petit écrit localStorage (`_ecrit_at` ou le journal) a été refusé ; la base complète part en
 *     IndexedDB avec `travailA`, et F1 la remonte au démarrage en ligne suivant — la même durabilité que
 *     l'EDL en ligne → `true`, avis unique « enregistré sur cet appareil » (audit lots 2-3, 🟠1 : dire
 *     « PAS enregistrée, la refaire » faisait saisir l'EDL deux fois).
 * Un mode inconnu est traité comme une perte (on ne promet jamais un enregistrement qu'on ne peut prouver).
 * `unique` : clé d'avis donné une seule fois par session (false = message à chaque perte, anti-rafale 10 s).
 * @returns {{ retour:boolean, type:'warn'|'err', unique:string|false, message:string }}
 */
export function verdictEchecMiroir({ mode, sandbox = false, quoi, miroirIdb = false } = {}) {
  if (mode === 'cloud-en-ligne') {
    if (estEdl(quoi) && !miroirIdb) return { retour: false, type: 'err', unique: 'edl', message: TEXTES_ECHEC_MIROIR.edl };
    return { retour: true, type: 'warn', unique: 'copie', message: TEXTES_ECHEC_MIROIR.enLigne };
  }
  if (mode === 'cloud-hors-ligne' && remonteeParF1(quoi) && miroirIdb) {
    return { retour: true, type: 'warn', unique: 'edl-hors-ligne', message: TEXTES_ECHEC_MIROIR.edlHorsLigne };
  }
  if (mode === 'cloud-reseau-coupe') return { retour: false, type: 'err', unique: false, message: TEXTES_ECHEC_MIROIR.reseauCoupe };
  if (mode === 'cloud-session-morte') return { retour: false, type: 'err', unique: false, message: TEXTES_ECHEC_MIROIR.sessionMorte };
  if (mode === 'local') return { retour: false, type: 'err', unique: false, message: sandbox ? TEXTES_ECHEC_MIROIR.sandbox : TEXTES_ECHEC_MIROIR.local };
  return { retour: false, type: 'err', unique: false, message: TEXTES_ECHEC_MIROIR.horsLigne };
}

/** Le mode du miroir, à partir de ce que l'app sait au moment de l'écriture. */
export function modeMiroir({ cloud, horsLigne, enLigne, sessionMorte }) {
  if (!cloud) return 'local';
  if (horsLigne) return 'cloud-hors-ligne';
  if (sessionMorte) return 'cloud-session-morte';
  if (enLigne === false) return 'cloud-reseau-coupe';
  return 'cloud-en-ligne';
}

const deux = n => String(n).padStart(2, '0');
/** « aujourd'hui à 14:32 » / « le 06/10 à 14:32 » (heure locale). */
export function quandCourt(t, maintenant = Date.now()) {
  const d = new Date(t), m = new Date(maintenant);
  const heure = deux(d.getHours()) + ':' + deux(d.getMinutes());
  const memeJour = d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth() && d.getDate() === m.getDate();
  return memeJour ? 'aujourd’hui à ' + heure : 'le ' + deux(d.getDate()) + '/' + deux(d.getMonth() + 1) + ' à ' + heure;
}

/**
 * §3.7 — l'état de la copie hors ligne de cet appareil, pour la carte de Réglages. Priorité : le plus
 * grave d'abord (pas à jour > incomplète > mode réduit > à jour). `ton` = classe de pastille de l'app
 * (`grn` vert = va bien, `blu` corail = à regarder, `gry` neutre — charte M-15).
 * @param {object} o
 * @param {boolean} o.cloud           session cloud (sinon : sandbox ou ancien mode local)
 * @param {boolean} o.sandbox
 * @param {string|null} o.backend     'indexeddb' | 'localStorage' | null (miroir pas prêt)
 * @param {boolean} o.copieIncomplete
 * @param {number} o.echecDepuis      0, ou heure de la 1re écriture ratée depuis la dernière réussie
 * @param {number} o.dernierOk        0, ou heure de la dernière écriture réussie connue
 * @param {boolean} [o.plein]         la dernière écriture ratée l'a été faute de place (`estQuotaDepasse`) ; sinon
 *                                    (IndexedDB en échec, erreur inconnue) la carte ne parle pas de place
 * @returns {{ etat:string, libelle:string, ton:string, explication:string }}
 */
export function etatCopieAppareil({ cloud, sandbox, backend = null, copieIncomplete = false, echecDepuis = 0, dernierOk = 0, enLigne = true, plein = false, maintenant = Date.now() }) {
  if (!cloud) {
    return sandbox
      ? { etat: 'test', libelle: 'Base de test', ton: 'gry', explication: 'Mode test : les données sont gardées dans ce navigateur uniquement.' }
      : { etat: 'local', libelle: 'Base locale', ton: 'gry', explication: 'Les données sont gardées dans ce navigateur uniquement.' };
  }
  if (echecDepuis) {
    const depuis = dernierOk && dernierOk < echecDepuis ? dernierOk : echecDepuis;
    const q = quandCourt(depuis, maintenant);
    const libelle = 'Pas à jour depuis ' + (q.startsWith('le ') ? q : q.replace(/^aujourd’hui à /, ''));
    // La cause : « plein » seulement si le navigateur a refusé faute de place ; un échec d'IndexedDB (ou une
    // erreur inconnue) n'est pas un manque de place (retour pilotage du 17/10).
    const cause = plein ? 'Le stockage de cet appareil est plein.' : 'Le stockage local de cet appareil a échoué.';
    // Hors ligne / réseau coupé / session expirée : rien ne garantit que le cloud a reçu (contre-audit, I3).
    if (!enLigne) return { etat: 'pas-a-jour', libelle, ton: 'blu',
      explication: cause + ' Sans réseau, les modifications qui ne sont pas encore parties au cloud ne sont pas en sécurité.' };
    // « partent au cloud », jamais « bien enregistrées » : la carte ne sait pas si l'envoi a abouti (même règle que `enLigne`, 🟡1).
    return { etat: 'pas-a-jour', libelle, ton: 'blu',
      explication: cause + ' Les modifications partent au cloud ; sans réseau, cet appareil afficherait les données ' + (q.startsWith('le ') ? 'du ' + q.slice(3) : 'd’' + q) + '.' };
  }
  if (copieIncomplete) {
    return { etat: 'incomplete', libelle: 'Incomplète', ton: 'blu',
      explication: 'La base ne tient pas entièrement sur cet appareil : sans réseau, les données affichées seraient anciennes.' };
  }
  if (backend === 'localStorage') {
    return { etat: 'reduit', libelle: 'Mode réduit', ton: 'blu',
      explication: 'Ce navigateur refuse le stockage étendu (navigation privée ?). La copie hors ligne est limitée à environ 5 Mo sur cet appareil.' };
  }
  return { etat: 'a-jour', libelle: 'À jour', ton: 'grn',
    explication: dernierOk ? 'Dernière mise à jour ' + quandCourt(dernierOk, maintenant) + '.' : 'Copie faite à l’ouverture de la session.' };
}

/** Une taille en « Mo » lisible (caractères ≈ octets pour l'utilisateur), virgule décimale. */
export function enMo(caracteres) {
  const mo = (Number(caracteres) || 0) / (1024 * 1024);
  return (mo < 0.1 && mo > 0 ? '< 0,1' : mo.toFixed(1).replace('.', ',')) + ' Mo';
}

/** Occupation du localStorage (caractères, unité du quota Chromium). Ne lève jamais (accès refusé compris). */
export function occupationStockage(lireStorage) {
  try { const st = typeof lireStorage === 'function' ? lireStorage() : lireStorage; return lireEntrees(st).reduce((s, e) => s + e.taille, 0); }
  catch (_e) { return 0; }
}
