/**
 * core/miroir-local.js — le MIROIR LOCAL de la base en mode cloud, en IndexedDB
 * (CDC docs/CDC-STOCKAGE.md §3.8, lot 4 ; décision D4 B).
 *
 * ═══ POURQUOI ═════════════════════════════════════════════════════════════
 * En mode cloud, une copie complète de la base vit sur l'appareil. Elle sert au
 * démarrage hors ligne, à la remontée F1 des états des lieux faits hors ligne et
 * à la garde de déconnexion. Jusqu'au lot 3 elle vivait dans `localStorage`
 * (≈ 5 Mo par origine). Mesure réelle du 30/09 : 2,47 M caractères, soit près de
 * la moitié du plafond pour UN propriétaire. Un grand compte ne tiendrait plus.
 *
 * ═══ LE CONTRAT : ZÉRO PERTE D'EDL FAIT HORS LIGNE ═════════════════════════
 * Trois mécanismes, qui se couvrent l'un l'autre :
 *   1. La BASE COMPLÈTE part en IndexedDB (écritures `durability: 'strict'`, par
 *      une FILE SÉRIE : une transaction en vol au plus, plus une en attente).
 *      L'enregistrement porte `travailA` (heure du dernier travail local) et le
 *      `tag` de son propriétaire : F1 et la garde lisent le MAX entre
 *      `_ecrit_at` (localStorage) et `travailA` (IndexedDB).
 *   2. Les enregistrements d'EDL pas encore ENGAGÉS en IndexedDB sont écrits
 *      SYNCHRONEMENT dans un petit journal `localStorage`, après `_ecrit_at`.
 *      Ce qui est garanti — mesuré au 3e audit, pas supposé :
 *        - onglet fermé, rechargé, ou processus de l'onglet planté : l'EDL est
 *          relu (journal) même si la transaction IndexedDB n'a pas abouti ;
 *        - NAVIGATEUR ENTIER tué dans les ~2 s : Chromium peut perdre les
 *          écritures localStorage récentes (journal ET `_ecrit_at`) ; l'EDL est
 *          alors relu depuis IndexedDB, et F1 le voit grâce à `travailA`.
 *   3. Un miroir IndexedDB ILLISIBLE n'est JAMAIS traité comme absent : état
 *      tri-valué (base / absente / illisible). Illisible alors que du travail
 *      n'est pas remonté → mode PROTÉGÉ : aucune écriture ne l'écrase sans avoir
 *      relu et FUSIONNÉ ses EDL, le dernier envoi réussi n'avance plus, la
 *      déconnexion est refusée.
 * Le transfert localStorage → IndexedDB FUSIONNE les EDL (jamais d'écrasement
 * sur la seule foi d'un horodatage) ; un miroir d'un autre propriétaire (tag)
 * n'est ni servi ni fusionné.
 *
 * ═══ REPLI ═════════════════════════════════════════════════════════════════
 * IndexedDB absent, refusé, muet (> 3 s, `open` comme `databases()`), ou en
 * échec d'écriture → le miroir complet repart en `localStorage` (lot 1,
 * éviction comprise) et le repli est SIGNALÉ. Avant toute lecture pour F1,
 * IndexedDB est RETENTÉ. Repli PROTÉGÉ (IndexedDB au contenu inconnu) : journal
 * et horodatage d'abord, puis la base complète en local si elle TIENT ; sinon
 * la copie hors ligne est déclarée incomplète (signal, marque persistante,
 * message au démarrage hors ligne), les EDL restant au journal. En mode protégé,
 * la clé locale n'est JAMAIS réécrite sans relire et fusionner ses EDL (P10).
 *
 * ═══ LIMITES ASSUMÉES (mode protégé, contre-audit du 01/10) ══════════════════
 *   - Un rebase ou une restauration n'entre jamais au journal ; la version d'un
 *     même EDL présente dans IndexedDB ou dans une clé locale est départagée par
 *     `_modifiedAt` (fusion), comme partout ailleurs hors journal.
 *   - Restauration d'une sauvegarde pendant une session protégée : les EDL du
 *     journal, et ceux d'IndexedDB plus récents que l'instantané, sont
 *     RÉAPPLIQUÉS au démarrage suivant (F1). Aucune garde simple ne distingue
 *     « travail non remonté » de « version que la restauration voulait
 *     défaire » : vider le journal à la restauration perdrait le premier.
 *     Résurrection d'un EDL plutôt que perte.
 *   - Copie hors ligne trop grande pour le stockage local : au démarrage hors
 *     ligne suivant, la base affichée est une copie ANCIENNE (IndexedDB ou clé
 *     locale d'avant la session protégée), EDL du journal superposés ; le
 *     bandeau hors ligne le dit tant qu'une copie complète reçue du cloud n'a
 *     pas été réécrite.
 *   - Espace RÉVOQUÉ pendant une session protégée : la fusion (clé locale comme
 *     IndexedDB) garde sur l'appareil les EDL de cet espace qui y étaient déjà.
 *     Le miroir ne connaît pas les espaces autorisés et ne filtre pas : ces EDL
 *     ne sont ni affichés (démarrage hors ligne filtré) ni remontés (F1 filtré),
 *     et disparaissent à la première écriture NON protégée (le rebase repart
 *     alors de la vue autorisée, sans fusion), au changement d'utilisateur et à
 *     la déconnexion. Filtrer ici dupliquerait la règle d'espaces d'offline-boot.
 */
import { ecrireAvecLiberation, MIROIR_KEY, MIROIR_ECRIT_KEY, MIRROR_TAG_KEY } from './stockage-local.js';

export const MIROIR_IDB = 'immotrack_miroir';
export const MIROIR_STORE = 'miroir';
export const MIROIR_ENREG = 'courant';
/** Le journal synchrone des EDL pas encore engagés en IndexedDB (clé du registre, classe « principal »). */
export const JOURNAL_EDL_KEY = MIROIR_KEY + '_edl_attente';
/** Posée quand la copie hors ligne n'a pas pu être écrite en entier (repli protégé, base trop grande) ; retirée dès qu'une copie complète est écrite. */
export const COPIE_INCOMPLETE_KEY = MIROIR_KEY + '_copie_incomplete';
/** Délai au-delà duquel une opération IndexedDB muette est traitée comme un refus. */
export const DELAI_OUVERTURE_MS = 3000;

/** Une promesse bornée dans le temps : au-delà, rejet `indexeddb-muet`. */
function avecDelai(p, ms) {
  let minuterie;
  const delai = new Promise((_r, rej) => { minuterie = setTimeout(() => rej(new Error('indexeddb-muet')), ms); });
  return Promise.race([Promise.resolve(p), delai]).finally(() => clearTimeout(minuterie));
}

// ── Adaptateur IndexedDB réel ────────────────────────────────────────────────────────────────

/**
 * UNE connexion, gardée ouverte, fermée sur `versionchange` (sinon une suppression de la base au
 * logout resterait bloquée). Toutes les écritures en `durability: 'strict'` quand le navigateur le
 * permet : le miroir est un filet, pas un cache.
 */
export function adaptateurIndexedDB(fabrique, { nom = MIROIR_IDB, delaiMs = DELAI_OUVERTURE_MS } = {}) {
  let conn = null;
  let ouverture = null;
  const ouvrir = () => {
    if (conn) return Promise.resolve(conn);
    if (ouverture) return ouverture;
    ouverture = new Promise((res, rej) => {
      let fini = false;
      const minuterie = setTimeout(() => { if (!fini) { fini = true; rej(new Error('indexeddb-muet')); } }, delaiMs);
      let r;
      try { r = fabrique.open(nom, 1); } catch (e) { fini = true; clearTimeout(minuterie); rej(e); return; }
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(MIROIR_STORE)) db.createObjectStore(MIROIR_STORE); };
      r.onsuccess = () => {
        const db = r.result;
        if (fini) { try { db.close(); } catch (_e) {} return; }
        fini = true; clearTimeout(minuterie);
        conn = db;
        conn.onversionchange = () => { try { conn.close(); } catch (_e) {} conn = null; };
        res(conn);
      };
      r.onerror = () => { if (!fini) { fini = true; clearTimeout(minuterie); rej(r.error || new Error('indexeddb-erreur')); } };
      r.onblocked = () => { if (!fini) { fini = true; clearTimeout(minuterie); rej(new Error('indexeddb-bloque')); } };
    }).finally(() => { ouverture = null; });
    return ouverture;
  };
  const transaction = (db, mode) => {
    if (mode === 'readwrite') { try { return db.transaction(MIROIR_STORE, mode, { durability: 'strict' }); } catch (_e) { /* option inconnue */ } }
    return db.transaction(MIROIR_STORE, mode);
  };
  const operer = (mode, geste) => ouvrir().then(db => new Promise((res, rej) => {
    const t = transaction(db, mode);
    let valeur;
    t.oncomplete = () => res(valeur);
    t.onerror = () => rej(t.error || new Error('indexeddb-transaction'));
    t.onabort = () => rej(t.error || new Error('indexeddb-abandon'));
    const req = geste(t.objectStore(MIROIR_STORE));
    if (req) req.onsuccess = () => { valeur = req.result; };
  }));
  return {
    /**
     * La base existe-t-elle, SANS la créer ? (`indexedDB.open` crée la base : l'appeler au démarrage
     * recréerait une base vide juste après la purge RGPD du logout.) true / false, ou null si le
     * navigateur ne sait pas le dire ou ne répond pas (`databases()` absent ou MUET : borné, audit O2).
     * Lève si IndexedDB est refusé.
     */
    existe: async () => {
      if (typeof fabrique.databases !== 'function') return null;
      let liste;
      try { liste = await avecDelai(fabrique.databases(), delaiMs); }
      catch (e) { if (e && e.message === 'indexeddb-muet') return null; throw e; }
      return Array.isArray(liste) && liste.some(d => d && d.name === nom);
    },
    lire: () => operer('readonly', s => s.get(MIROIR_ENREG)),
    ecrire: (enr) => operer('readwrite', s => s.put(enr, MIROIR_ENREG)),
    effacer: () => operer('readwrite', s => s.delete(MIROIR_ENREG)),
    supprimerBase: () => new Promise(res => {
      try { if (conn) conn.close(); } catch (_e) {}
      conn = null;
      try { const r = fabrique.deleteDatabase(nom); r.onsuccess = r.onerror = r.onblocked = () => res(); }
      catch (_e) { res(); }
    }),
  };
}

// ── Identité et fusion des EDL ────────────────────────────────────────────────────────────────

const cleEdl = r => String(r && r.id) + '@@' + ((r && r._espaceId) || '');
const dateDe = r => Date.parse((r && r._modifiedAt) || '') || 0;

/**
 * Index d'une liste d'EDL : par clé complète (id + espace), et par id quand il est UNIQUE dans la
 * liste — un EDL dont le tag d'espace a changé est reconnu, sans doublon (audit, point 🟡).
 */
function indexer(liste) {
  const parCle = new Map(), parId = new Map();
  liste.forEach((r, i) => {
    if (!r) return;
    parCle.set(cleEdl(r), i);
    const id = String(r.id);
    parId.set(id, parId.has(id) ? -1 : i);
  });
  return {
    trouver(r) {
      const i = parCle.get(cleEdl(r));
      if (i != null) return i;
      const j = parId.get(String(r && r.id));
      return (j != null && j >= 0) ? j : null;
    },
    ajouter(r, i) { parCle.set(cleEdl(r), i); const id = String(r.id); parId.set(id, parId.has(id) ? -1 : i); },
  };
}

/**
 * Superpose les EDL du JOURNAL : ils gagnent SANS CONDITION. Par construction, le journal ne contient
 * que du travail local non engagé — plus récent que ce qu'il remplace, quelle que soit l'horloge qui
 * a posé les `_modifiedAt` (audit O1 : horloges d'appareils décalées). Absent → ajouté.
 */
export function superposerJournal(db, journal) {
  const edlJ = journal && Array.isArray(journal.edl) ? journal.edl : [];
  if (!edlJ.length) return db;
  const base = db && typeof db === 'object' ? db : {};
  const liste = Array.isArray(base.edl) ? base.edl.slice() : [];
  const ix = indexer(liste);
  for (const r of edlJ) {
    if (!r) continue;
    const i = ix.trouver(r);
    if (i == null) { ix.ajouter(r, liste.length); liste.push(r); }
    else liste[i] = r;
  }
  return Object.assign({}, base, { edl: liste });
}

/**
 * Fusion de deux listes d'EDL (transfert, écriture protégée) : UNION ; sur un même EDL, le plus
 * récent par `_modifiedAt` gagne, à égalité la liste PRINCIPALE gagne. Aucun EDL ne disparaît.
 */
export function fusionnerEdl(principale, autre) {
  const liste = Array.isArray(principale) ? principale.slice() : [];
  const ix = indexer(liste);
  for (const r of (Array.isArray(autre) ? autre : [])) {
    if (!r) continue;
    const i = ix.trouver(r);
    if (i == null) { ix.ajouter(r, liste.length); liste.push(r); }
    else if (dateDe(r) > dateDe(liste[i])) liste[i] = r;
  }
  return liste;
}

const carteEdl = db => { const m = new Map(); for (const r of (db && Array.isArray(db.edl) ? db.edl : [])) if (r) m.set(cleEdl(r), JSON.stringify(r)); return m; };

// ── Le miroir ─────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object|null} o.idb       adaptateur { existe?, lire, ecrire, effacer, supprimerBase } (ou null)
 * @param {Storage} o.stockage       localStorage (journal, horodatage, tag, repli)
 * @param {object} [o.cles]          { miroir, ecritA, journal, tag }
 * @param {Function} [o.horloge]
 * @param {Function} [o.signaler]    ({ type, erreur }) → l'app l'affiche
 * @param {number} [o.delaiMs]       borne des opérations IndexedDB (3 s)
 */
export function creerMiroir({ idb, stockage, cles = {}, horloge = () => Date.now(), signaler = () => {}, delaiMs = DELAI_OUVERTURE_MS }) {
  const K = {
    miroir: cles.miroir || MIROIR_KEY, ecritA: cles.ecritA || MIROIR_ECRIT_KEY,
    journal: cles.journal || JOURNAL_EDL_KEY, tag: cles.tag || MIRROR_TAG_KEY,
    incomplete: cles.incomplete || COPIE_INCOMPLETE_KEY,
  };
  let backend = null;           // null (pas initialisé) | 'indexeddb' | 'localStorage'
  let idbIncertain = false;     // IndexedDB n'a pas pu être LU : son contenu est INCONNU (jamais « absent »)
  let presentIdb = false;       // un enregistrement de CE propriétaire existe en IndexedDB
  let ferme = false;            // après la purge du logout : plus aucune écriture
  let protege = false;          // miroir illisible porteur possible de travail non remonté
  let engages = new Map();      // cleEdl → JSON de l'EDL tel qu'engagé en IndexedDB
  let dernier = null;           // la base à écrire (référence vivante, la plus récente)
  let travailBase = 0;          // `travailA` lu dans l'enregistrement au démarrage
  let travailSession = 0;       // heure du dernier travail local de la session (écritures horodatées)
  let gen = 0;                  // génération : oublier / vider rendent caduques les écritures d'avant
  let file = Promise.resolve(); // FILE SÉRIE de toutes les opérations IndexedDB
  let ecritureEnFile = false;
  let avertir = signaler;

  const tagCourant = () => { try { return stockage.getItem(K.tag) || null; } catch (_e) { return null; } };
  const estAMoi = enr => !!enr && ((enr.tag || null) === tagCourant());
  const lireIdb = () => avecDelai(idb.lire(), delaiMs);
  const enFile = (op) => { const p = file.then(op); file = p.catch(() => {}); return p; };
  const lireJournal = () => { try { return JSON.parse(stockage.getItem(K.journal) || 'null'); } catch (_e) { return null; } };
  const edlEnAttente = (db) => (db && Array.isArray(db.edl) ? db.edl : []).filter(r => r && engages.get(cleEdl(r)) !== JSON.stringify(r));
  const travail = () => Math.max(travailBase, travailSession);
  const ok = { ok: true, liberees: [], caracteresLiberes: 0, erreur: null };

  /** Le journal des EDL non engagés (ou son retrait). SANS l'horodatage : écrit à part, AVANT (O3). */
  function ecrireJournal(db, ecritA) {
    let attente = edlEnAttente(db);
    // Mode PROTÉGÉ : le journal peut porter un EDL fait hors ligne jamais engagé ni remonté (F1 a levé,
    // ou IndexedDB est illisible). La base vivante — rendue par le cloud — ne le contient pas : il ne
    // doit JAMAIS sortir du journal. Le journal devient CUMULATIF : les entrées existantes restent, la
    // version vivante d'un même EDL les remplace (contre-audit C1/C2).
    if (protege) {
      const prec = lireJournal();
      if (prec && Array.isArray(prec.edl) && prec.edl.length) attente = superposerJournal({ edl: prec.edl }, { edl: attente }).edl;
    }
    if (!attente.length) { try { stockage.removeItem(K.journal); } catch (_e) {} return ok; }
    return ecrireAvecLiberation(stockage, [[K.journal, JSON.stringify({ ecritA, edl: attente })]]);
  }

  /**
   * Contre-audit P10 — en mode PROTÉGÉ, la clé locale peut porter un EDL fait hors ligne pendant un
   * repli précédent (IndexedDB muet ou refusé) et jamais remonté (F1 a levé) : la base vivante, rendue
   * par le cloud, ne le contient pas. Toute réécriture de la clé locale la RELIT donc et FUSIONNE ses
   * EDL (union ; même EDL → le plus récent par `_modifiedAt`, à égalité la base vivante) — la même
   * règle que l'écriture IndexedDB protégée et que F1 pour remonter. Hors mode protégé : inchangé.
   */
  function avecEdlCleLocale(db) {
    if (!protege) return db;
    let ancienne = null;
    try { ancienne = JSON.parse(stockage.getItem(K.miroir) || 'null'); } catch (_e) { ancienne = null; }
    if (!ancienne || !Array.isArray(ancienne.edl) || !ancienne.edl.length) return db;
    return Object.assign({}, db, { edl: fusionnerEdl(db && db.edl, ancienne.edl) });
  }
  // La marque « copie incomplète » ne tombe que quand une copie COMPLÈTE de la base reçue du cloud
  // pendant CETTE session (rebase vu) est écrite : une session hors ligne réécrit la copie ancienne,
  // elle ne la rend pas plus récente.
  let sessionCloud = false;
  const marquerCopieComplete = (cloudInclus = sessionCloud) => { if (!cloudInclus) return; try { stockage.removeItem(K.incomplete); } catch (_e) {} };

  /**
   * Repli protégé (IndexedDB inconnu) : la base complète en local, seulement si elle TIENT (éviction
   * du lot 1 comprise), EDL de la clé existante fusionnés (P10). Échec → la clé existante reste telle
   * quelle (elle peut porter des EDL d'un repli précédent), plus d'essai dans la session (pas de
   * sérialisation de plusieurs Mo à chaque enregistrement pour rien), signal « copie-incomplete » et
   * marque persistante (le démarrage hors ligne suivant le dit). Ne lève jamais.
   */
  let baseLocaleTropGrande = false;
  function ecrireBaseLocaleSiTient(db) {
    if (baseLocaleTropGrande) return false;
    let json;
    try { json = JSON.stringify(avecEdlCleLocale(db)); } catch (_e) { return false; }
    const r = ecrireAvecLiberation(stockage, [[K.miroir, json]]);
    if (!r.ok) {
      baseLocaleTropGrande = true;
      try { stockage.setItem(K.incomplete, String(horloge())); } catch (_e) {}
      avertir({ type: 'copie-incomplete', erreur: r.erreur });
      return false;
    }
    marquerCopieComplete();
    return true;
  }

  function ecrireLocal(db, ecritA, horodater) {
    if (horodater) { const r1 = ecrireAvecLiberation(stockage, [[K.ecritA, String(ecritA)]]); if (!r1.ok) throw r1.erreur; }
    const r = ecrireAvecLiberation(stockage, [[K.miroir, JSON.stringify(avecEdlCleLocale(db))]]);
    if (!r.ok) throw r.erreur;
    marquerCopieComplete();
    return true;
  }

  function basculerRepli(motif, erreur) {
    backend = 'localStorage';
    if (motif) avertir({ type: motif, erreur });
  }

  /** Planifie UNE écriture de la base (coalescée : jamais plus d'une en attente). */
  function planifierEcriture() {
    if (ecritureEnFile) return file;
    ecritureEnFile = true;
    const g = gen;
    return enFile(async () => {
      ecritureEnFile = false;                              // une demande ultérieure replanifie
      if (g !== gen || ferme || backend !== 'indexeddb' || !dernier) return;
      const cible = dernier;
      const cloudInclus = sessionCloud;
      let aEcrire = cible;
      if (protege) {
        // Miroir porteur possible de travail non remonté : on RELIT et on FUSIONNE ses EDL avant
        // d'écrire. Illisible → on n'écrit pas (le journal garde les EDL de la session).
        let enr;
        try { enr = await lireIdb(); } catch (_e) { return; }
        if (g !== gen) return;
        if (enr && enr.json && estAMoi(enr)) {
          let ancienne = null;
          try { ancienne = JSON.parse(enr.json); } catch (_e) { return; }
          aEcrire = Object.assign({}, cible, { edl: fusionnerEdl(cible.edl, ancienne && ancienne.edl) });
          travailBase = Math.max(travailBase, Number(enr.travailA) || 0);
        }
      }
      const json = JSON.stringify(aEcrire);
      const eng = carteEdl(cible);
      try {
        await idb.ecrire({ v: 2, ecritA: horloge(), travailA: travail(), tag: tagCourant(), json });
      } catch (e) {
        if (g !== gen) return;
        // IndexedDB refuse l'écriture : le journal garde les EDL ; le miroir complet repart en local.
        basculerRepli('echec-ecriture', e);
        try { ecrireLocal(dernier, horloge(), false); try { stockage.removeItem(K.journal); } catch (_e) {} }
        catch (e2) { avertir({ type: 'echec-repli', erreur: e2 }); }
        return;
      }
      if (g !== gen) return;                                // oublié / vidé pendant la transaction
      presentIdb = true; idbIncertain = false;
      marquerCopieComplete(cloudInclus);
      engages = eng;
      if (!ferme && dernier) {
        // Ce qui a été modifié PENDANT la transaction reste au journal jusqu'à la suivante.
        const r = ecrireJournal(dernier, horloge());
        if (!r.ok) avertir({ type: 'echec-repli', erreur: r.erreur });
      }
    });
  }

  const api = {
    /** Le backend actif : null (pas encore initialisé), 'indexeddb' ou 'localStorage'. */
    backend: () => backend,
    pret: () => backend !== null && !ferme,
    /** Brancher l'affichage des signaux (repli, échec) une fois l'app prête. */
    surSignal(fn) { if (typeof fn === 'function') avertir = fn; },
    /** Heure du dernier travail local connu (enregistrement IndexedDB + session) — F1 et garde en prennent le MAX avec `_ecrit_at`. */
    travailA: travail,
    /** Mode protégé : un miroir illisible porte peut-être du travail non remonté. */
    protege: () => protege,
    /** F1 a trouvé le miroir illisible alors que du travail n'est pas remonté. */
    proteger() { protege = true; },
    /** La dernière copie hors ligne n'a pas pu être écrite en entier : celle de l'appareil est ANCIENNE. */
    copieIncomplete() { try { return !!stockage.getItem(K.incomplete); } catch (_e) { return false; } },
    /** IndexedDB au contenu inconnu (lecture impossible) ? */
    incertain: () => idbIncertain,
    /** Repli décidé au démarrage sur un IndexedDB MUET : nouvelle tentative (avant F1). Sinon, rien. */
    async retenterSiIncertain() {
      if (backend === 'localStorage' && idbIncertain && idb && !ferme) await api.initialiser({ reessai: true });
    },

    /**
     * Ouvre IndexedDB et TRANSFÈRE un miroir `localStorage` existant en FUSIONNANT les EDL : écrire,
     * RELIRE, COMPARER, puis seulement supprimer la clé locale. Tout échec → rien n'est supprimé.
     * `reessai` : nouvelle tentative (avant F1) après un repli décidé au démarrage.
     */
    async initialiser({ reessai = false } = {}) {
      if (backend && !reessai) return { backend, transfert: 'deja' };
      if (!idb) { basculerRepli('repli', new Error('indexeddb-absent')); return { backend, transfert: 'aucun' }; }
      const brut = stockage.getItem(K.miroir);
      // Rien à transférer et aucune base : on n'OUVRE pas (ouvrir crée la base — elle réapparaîtrait,
      // vide, juste après la purge du logout). Ouverture différée à la première écriture.
      if (brut == null && typeof idb.existe === 'function') {
        let existe = null;
        try { existe = await idb.existe(); } catch (_e) { existe = null; }
        if (existe === false) { backend = 'indexeddb'; idbIncertain = false; presentIdb = false; return { backend, transfert: 'aucun' }; }
      }
      let enr;
      try { enr = await lireIdb(); }
      catch (e) {
        // REFUS (IndexedDB interdit : navigation privée, réglage) : rien n'a pu y être écrit, il est
        // absent pour nous. Toute AUTRE erreur (muet, erreur interne) : son contenu est INCONNU.
        const refus = !!e && (e.name === 'SecurityError' || e.name === 'InvalidStateError');
        idbIncertain = !refus;
        basculerRepli(reessai ? null : 'repli', e);
        return { backend, transfert: 'aucun' };
      }
      idbIncertain = false;
      // Tag du miroir PERDU (navigateur tué : Chromium perd les écritures localStorage récentes, 3e audit
      // O4) alors que l'enregistrement IndexedDB porte le sien : on le RESTAURE. Sans lui, le miroir de
      // CE propriétaire passerait pour celui d'un autre et serait effacé au login (F1 ne le verrait pas).
      // Aucun risque RGPD de plus : ce tag a été écrit par l'app, pour ce même appareil ; si le tag local
      // EXISTE et diffère, c'est bien un autre propriétaire et rien n'est restauré.
      if (enr && enr.tag && !tagCourant()) { try { stockage.setItem(K.tag, enr.tag); } catch (_e) {} }
      // Un enregistrement d'un AUTRE propriétaire (ou sans tag) n'est jamais servi ni fusionné (RGPD).
      const aMoi = estAMoi(enr) && !!(enr && enr.json);
      let baseIdb = null;
      if (aMoi) { try { baseIdb = JSON.parse(enr.json); } catch (_e) { baseIdb = null; } }
      presentIdb = !!baseIdb;
      if (baseIdb) { travailBase = Math.max(travailBase, Number(enr.travailA) || 0); engages = carteEdl(baseIdb); }
      let transfert = 'aucun';
      if (brut != null) {
        let baseLs = null;
        try { baseLs = JSON.parse(brut); } catch (_e) { baseLs = null; }
        if (baseLs) {
          const ecritLs = parseInt(stockage.getItem(K.ecritA) || '0', 10) || 0;
          let cible;
          if (baseIdb && (Number(enr.ecritA) || 0) >= ecritLs && ecritLs) {
            cible = Object.assign({}, baseIdb, { edl: fusionnerEdl(baseIdb.edl, baseLs.edl) });   // IndexedDB plus récent
            transfert = 'local-perime';
          } else {
            cible = baseIdb ? Object.assign({}, baseLs, { edl: fusionnerEdl(baseLs.edl, baseIdb.edl) }) : baseLs;
            transfert = baseIdb ? 'fusion' : 'fait';
          }
          const json = JSON.stringify(cible);
          const travailT = Math.max(travailBase, ecritLs);
          try {
            await avecDelai(idb.ecrire({ v: 2, ecritA: Math.max(Number(enr && enr.ecritA) || 0, ecritLs) || horloge(), travailA: travailT, tag: tagCourant(), json }), delaiMs);
            const relu = await lireIdb();
            if (!relu || relu.json !== json) throw new Error('transfert-non-conforme');
          } catch (e) {
            basculerRepli('transfert-echec', e);             // la clé locale RESTE : rien n'est perdu
            return { backend, transfert: 'echec' };
          }
          presentIdb = true; travailBase = travailT; engages = carteEdl(cible);
          // Pas de marquerCopieComplete() : le transfert recopie une copie de l'appareil (peut-être
          // ancienne), pas la base vivante d'une session.
          try { stockage.removeItem(K.miroir); } catch (_e) {}
        }
      }
      backend = 'indexeddb';
      return { backend, transfert };
    },

    /**
     * Écriture DEMANDÉE par saveDB. SYNCHRONE pour ce qui compte : `_ecrit_at` d'abord, dans son
     * propre setItem, puis le journal des EDL non engagés (ou, en repli, le miroir complet). La base
     * complète part ensuite en IndexedDB, coalescée. Contrat identique à `_miroirEcrire` : rend true,
     * ou LÈVE l'erreur de stockage (l'écriture IndexedDB est planifiée quoi qu'il arrive).
     * `opts.horodater === false` : rebase / restauration — l'état écrit EST celui du cloud.
     */
    ecrire(db, opts) {
      if (ferme) return true;
      const horodater = !(opts && opts.horodater === false);
      if (!horodater) sessionCloud = true;
      const ecritA = horloge();
      if (horodater) travailSession = ecritA;
      if (backend !== 'indexeddb' && protege && idbIncertain) {
        // Repli + mode protégé + IndexedDB au contenu INCONNU (la copie de l'appareil y est, intouchée).
        // Ce qui compte d'abord : l'horodatage et les EDL de la session, au journal synchrone. Ensuite,
        // la base complète en local QUAND ELLE TIENT (disponibilité hors ligne, contre-audit Q3) ; si
        // elle ne tient pas (grand compte), pas de « Mémoire pleine » à chaque enregistrement : la copie
        // hors ligne est déclarée incomplète, et le démarrage hors ligne le dit.
        dernier = db;
        if (!horodater) {
          // Rebase / restauration (P9) : c'est l'état du CLOUD, jamais du travail local. Il devient la
          // référence des « engagés » et n'entre JAMAIS au journal — sinon une version cloud gagnerait,
          // par la superposition du journal, sur un EDL modifié hors ligne resté dans IndexedDB.
          engages = carteEdl(db);
          ecrireBaseLocaleSiTient(db);
          return true;
        }
        const rh = ecrireAvecLiberation(stockage, [[K.ecritA, String(ecritA)]]);
        const rj = ecrireJournal(db, ecritA);
        if (!rh.ok) throw rh.erreur;
        if (!rj.ok) throw rj.erreur;
        ecrireBaseLocaleSiTient(db);
        return true;
      }
      if (backend !== 'indexeddb') return ecrireLocal(db, ecritA, horodater);
      dernier = db;
      const r1 = horodater ? ecrireAvecLiberation(stockage, [[K.ecritA, String(ecritA)]]) : ok;
      let r2;
      if (protege && !horodater) {
        // P9 — mode protégé, QUEL QUE SOIT le backend : un rebase (ou une restauration) n'ajoute JAMAIS
        // d'entrée au journal. La base écrite devient la référence des engagés ; le journal existant est
        // conservé ; l'écriture IndexedDB protégée (relire + fusionner les EDL) est planifiée.
        engages = carteEdl(db);
        r2 = ok;
      } else r2 = ecrireJournal(db, ecritA);
      planifierEcriture();
      if (!r1.ok) throw r1.erreur;
      if (!r2.ok) throw r2.erreur;
      return true;
    },

    /**
     * La vue du miroir, TRI-VALUÉE (audit R1) :
     *   { etat: 'base' | 'absente' | 'illisible', db }
     * `db` = ce qui a pu être lu (IndexedDB, sinon la clé locale) + journal superposé ; `illisible`
     * signale qu'IndexedDB peut porter davantage (il n'a pas pu être lu) — jamais confondu avec « absent ».
     * Après un repli décidé au démarrage, IndexedDB est RETENTÉ d'abord.
     */
    async lireEtat() {
      await api.retenterSiIncertain();
      let etat = 'absente';
      let db = null;
      if (backend === 'indexeddb' && idb && (presentIdb || idbIncertain)) {
        let enr, lu = false;
        for (let essai = 0; essai < 2 && !lu; essai++) {
          try { enr = await lireIdb(); lu = true; } catch (_e) { /* nouvel essai */ }
        }
        if (!lu) etat = 'illisible';
        else if (enr && enr.json && estAMoi(enr)) {
          try { db = JSON.parse(enr.json); etat = 'base'; } catch (_e) { etat = 'illisible'; }
          travailBase = Math.max(travailBase, Number(enr.travailA) || 0);
        }
      } else if (idbIncertain) etat = 'illisible';
      try {
        const brut = stockage.getItem(K.miroir);
        if (brut) {
          const loc = JSON.parse(brut);
          if (loc) db = db ? Object.assign({}, db, { edl: fusionnerEdl(db.edl, loc.edl) }) : loc;
          if (etat === 'absente') etat = 'base';
        }
      } catch (_e) { /* clé locale illisible : on garde ce qu'on a */ }
      const j = lireJournal();
      if (j && Array.isArray(j.edl) && j.edl.length) {
        db = superposerJournal(db, j);
        if (etat === 'absente') etat = 'base';
      }
      return { etat, db };
    },

    /** La base à afficher (démarrage hors ligne) : `lireEtat().db`. */
    async lire() { return (await api.lireEtat()).db; },

    /** Y a-t-il (peut-être) un miroir sur l'appareil ? Synchrone. Un IndexedDB illisible COMPTE. */
    present() {
      if (presentIdb || idbIncertain) return true;
      try { return !!stockage.getItem(K.journal) || !!stockage.getItem(K.miroir); } catch (_e) { return false; }
    },

    /** Attend la fin de la file IndexedDB (tests, purge, ordre F14.1 au login). */
    async attendre() { let f; do { f = file; await f; } while (f !== file); },

    /**
     * Changement d'utilisateur au LOGIN (synchrone pour le journal et la clé locale). L'effacement
     * IndexedDB est mis en file APRÈS la transaction en vol et AVANT toute écriture suivante, quel
     * que soit le backend (au mieux, borné) : en repli aussi, la base de l'ancien propriétaire part.
     * Les écritures d'avant deviennent caduques (génération).
     */
    oublier() {
      gen++; dernier = null; engages = new Map(); presentIdb = false; idbIncertain = false;
      travailBase = 0; travailSession = 0; protege = false; ecritureEnFile = false; sessionCloud = false; baseLocaleTropGrande = false;
      try { stockage.removeItem(K.journal); } catch (_e) {}
      try { stockage.removeItem(K.miroir); } catch (_e) {}
      try { stockage.removeItem(K.incomplete); } catch (_e) {}
      if (!idb) return Promise.resolve();
      return enFile(() => avecDelai(idb.effacer(), delaiMs).catch(e => avertir({ type: 'echec-effacement', erreur: e })));
    },

    /** Logout (RGPD) : plus aucune écriture, base IndexedDB SUPPRIMÉE, journal et clé locale retirés. */
    async vider() {
      ferme = true; gen++; dernier = null; engages = new Map(); presentIdb = false; idbIncertain = false; protege = false;
      try { stockage.removeItem(K.journal); } catch (_e) {}
      try { stockage.removeItem(K.miroir); } catch (_e) {}
      try { stockage.removeItem(K.incomplete); } catch (_e) {}
      if (idb) await enFile(() => idb.supprimerBase());
      await api.attendre();
    },
  };
  return api;
}

// ── L'instance de l'app (partagée par js/main.js → index.html et par supabase-entry.js) ─────────
let _instance = null;
/** Le miroir de l'app : même module = même instance pour tous ses importateurs. */
export function miroir() {
  if (!_instance) {
    const fabrique = (typeof indexedDB !== 'undefined') ? indexedDB : null;
    _instance = creerMiroir({
      idb: fabrique ? adaptateurIndexedDB(fabrique) : null,
      stockage: (typeof localStorage !== 'undefined') ? localStorage : null,
    });
  }
  return _instance;
}
