/**
 * core/edl-conflit.js — deux appareils, un état des lieux (chantier EDL
 * TERRAIN, lot 4bis).
 *
 * CDC docs/CDC-EDL.md §7 et §9 (invariants 29 à 34).
 *
 * ═══ POURQUOI CE MODULE SUIT IMMÉDIATEMENT LE HORS LIGNE ══════════════════
 * C'est le travail hors ligne qui crée le risque de conflit. Sans ce lot, le
 * lot 4 peut faire PERDRE UNE VISITE : aujourd'hui, un conflit de version
 * déclenche `_repullCloud({banner:true})` — « on re-hydrate TOUT (serveur
 * gagne) » — et la saisie locale est écrasée, avec une invitation à
 * « revérifier ». Défendable pour une modification de 30 secondes sur un
 * loyer. Inacceptable pour une heure de terrain : 110 éléments, 77 photos.
 *
 * Les trois situations réelles, dans l'ordre de probabilité (§7.3) :
 *   ① l'EDL de la tablette n'est pas remonté, le PC ne le voit pas → on le
 *     RECRÉE → doublon, rien ne l'empêche aujourd'hui ;
 *   ② le même EDL est ouvert sur deux appareils → rien ne le signale ;
 *   ③ le même EDL est modifié des deux côtés → le serveur écrase la tablette.
 *
 * Ce que ce module NE fait pas, et c'est délibéré (invariant 32) : **aucune
 * fusion automatique**. Fusionner deux saisies de 110 éléments donnerait un
 * résultat faux une fois sur deux et personne ne pourrait le vérifier. Sur un
 * document contradictoire signé par le locataire, c'est exclu.
 *
 * Ce module ne connaît QUE `DB.edl`. La règle « le serveur gagne » reste
 * appliquée à l'identique partout ailleurs (invariant 33) : une modification
 * de 30 secondes ne justifie pas un doublon.
 */

/* ── L'APPAREIL ──────────────────────────────────────────────────────────── */

/**
 * Le nom d'appareil qu'on AFFICHE. « commencé sur la tablette à 14h32 » n'a de
 * valeur que si « la tablette » veut dire quelque chose pour la personne.
 *
 * On reste volontairement grossier : trois familles, pas un modèle exact. Le
 * but est de se souvenir d'où on a travaillé, pas d'identifier une machine.
 */
export function nommerAppareil(ua, plateforme) {
  const s = String(ua || '') + ' ' + String(plateforme || '');
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) return 'la tablette';
  // Android SANS « Mobile » = tablette (convention de l'user-agent Android).
  if (/Android/i.test(s) && !/Mobile/i.test(s)) return 'la tablette';
  if (/iPhone|iPod|Android|Mobile|Windows Phone/i.test(s)) return 'le téléphone';
  if (!ua && !plateforme) return 'un autre appareil';
  return "l'ordinateur";
}

/** L'heure d'un horodatage, telle qu'on la dit : « 14h32 ». */
export function heureCourte(quand) {
  const d = quand instanceof Date ? quand : new Date(quand);
  if (!quand || isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');
}

/** Le jour et l'heure : « 20/08 à 16h12 ». */
export function jourEtHeure(quand) {
  const d = quand instanceof Date ? quand : new Date(quand);
  if (!quand || isNaN(d.getTime())) return '';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
    + ' à ' + heureCourte(d);
}

/**
 * La marque d'appareil portée par un enregistrement.
 *
 * Elle voyage dans `legacy_raw` (store-mapping.js : l'enregistrement legacy
 * ENTIER y est embarqué, et l'hydratation reconstruit le DB depuis lui) —
 * donc **aucune colonne cloud nouvelle** n'est nécessaire.
 *
 * @returns {{nom:string, id:string, quand:number}|null}
 */
export function marqueAppareil(edl) {
  const a = edl && edl._appareil;
  if (!a || typeof a !== 'object' || !a.id) return null;
  return { nom: a.nom || 'un autre appareil', id: String(a.id), quand: Number(a.quand) || 0 };
}

/** L'empreinte à POSER sur un enregistrement à chaque écriture. */
export function empreinteAppareil({ id, nom, maintenant = Date.now() } = {}) {
  if (!id) return null;
  return { id: String(id), nom: nom || 'un autre appareil', quand: Number(maintenant) || Date.now() };
}

/* ── ① LE DOUBLON, À LA CRÉATION (invariant 30) ──────────────────────────── */

const vivant = e => !!e && !e._deleted;
const memeJour = (a, b) => String(a || '').slice(0, 10) === String(b || '').slice(0, 10);

/**
 * Créer un EDL alors qu'il en existe déjà un pour CE logement, CE type et
 * CETTE date : on avertit, en nommant l'appareil et l'heure.
 *
 * Deux issues, et deux seulement : attendre la synchronisation, ou créer quand
 * même **en connaissance de cause**. On n'empêche jamais — le CDC est explicite
 * (§7.4 ①), et un blocage ici enfermerait quelqu'un debout dans un appartement.
 *
 * @returns {null|{edl:object, appareil:string, quand:number, message:string}}
 */
export function detecterDoublon({ edls = [], logement, type, date, idCourant = null, creation = true } = {}) {
  // L'invariant 30 vise la CRÉATION, et elle seule. Repérée au smoke : sans
  // cette porte, ré-enregistrer un EDL qui a légitimement un jumeau (l'utilisateur
  // a répondu « créer quand même ») reposait la question à CHAQUE écriture —
  // c'est-à-dire à chaque fermeture de modale, pour toute la vie du document.
  // Avertir une fois protège ; avertir sans fin apprend à cliquer sans lire.
  if (!creation) return null;
  if (!logement || !date) return null;
  const liste = Array.isArray(edls) ? edls : [];
  const jumeau = liste.find(e =>
    vivant(e)
    && (idCourant == null || String(e.id) !== String(idCourant))   // jamais soi-même
    && e.logement === logement
    && String(e.type || '') === String(type || '')
    && memeJour(e.date, date)
  );
  if (!jumeau) return null;
  const m = marqueAppareil(jumeau);
  const quand = (m && m.quand) || Date.parse(jumeau._modifiedAt || '') || 0;
  const ou = m ? m.nom : 'un autre appareil';
  const h = quand ? heureCourte(quand) : '';
  return {
    edl: jumeau,
    appareil: ou,
    quand,
    message: 'Un état des lieux existe déjà pour ' + logement + ' — ' + (type || '?')
      + ' du ' + String(date).slice(0, 10) + ', commencé sur ' + ou + (h ? ' à ' + h : '')
      + (m && quand ? '.' : ", pas encore remonté.")
      + '\n\nAttendre la synchronisation pour le reprendre, ou en créer un second en connaissance de cause '
      + '(il y aura alors deux états des lieux pour la même visite).',
  };
}

/* ── ② OUVERT AILLEURS (invariant 31) ────────────────────────────────────── */

/**
 * Un EDL non signé porte l'appareil et l'heure de sa dernière écriture. Les
 * autres appareils l'ouvrent en LECTURE SEULE, avec un bouton « Reprendre ici
 * quand même ».
 *
 * ⚠️ **Le verrou n'est JAMAIS bloquant.** Tablette perdue, batterie morte,
 * envie de finir au calme : on peut toujours reprendre, on est simplement
 * prévenu. `lectureSeule` est un ÉTAT INITIAL proposé, pas une interdiction —
 * `peutReprendre` est vrai dans tous les cas, sans exception.
 *
 * ⚠️ `lectureSeule` n'est PAS ENCORE APPLIQUÉ À L'ÉCRAN : un bandeau et un état
 * désactivé sur la modale de l'EDL appartiennent aux lots 5 à 8, gelés. Le
 * message ne le promet donc pas — il dit ce qui se passe réellement
 * aujourd'hui : on demande, et on n'ouvre en écriture que si on répond oui.
 * Promettre une lecture seule qui n'existe pas serait pire que se taire.
 *
 * @returns {{avertir:boolean, lectureSeule:boolean, peutReprendre:true, appareil:string, message:string}}
 */
export function verrouOuverture(edl, idAppareilCourant) {
  const rien = { avertir: false, lectureSeule: false, peutReprendre: true, appareil: '', message: '' };
  if (!edl) return rien;
  const m = marqueAppareil(edl);
  if (!m) return rien;                                   // jamais écrit ailleurs qu'ici
  if (idAppareilCourant && m.id === String(idAppareilCourant)) return rien;   // c'est nous
  const jh = m.quand ? jourEtHeure(m.quand) : '';
  return {
    avertir: true,
    lectureSeule: true,
    peutReprendre: true,
    appareil: m.nom,
    message: 'Cet état des lieux a été travaillé sur ' + m.nom + (jh ? ' le ' + jh : '')
      + '. Écrire ici en même temps risque de dédoubler la visite.'
      + '\n\nSi cet appareil-là n’est plus disponible, ou pour finir ici,'
      + ' choisir « Reprendre ici quand même ».',
  };
}

/* ── ③ LE CONFLIT RÉEL : LES DEUX VERSIONS VIVENT (invariants 29, 32) ────── */

/** Le nom d'une version conservée : « Ferrette-101 — version tablette du 20/08 16h12 ». */
export function nomVersionConservee(edl, appareil, quand) {
  const ou = String(appareil || 'cet appareil').replace(/^(la|le|l')\s*/i, '').replace(/^l’/i, '');
  const jh = quand ? jourEtHeure(quand).replace(' à ', ' ') : '';
  return String((edl && edl.logement) || 'État des lieux')
    + ' — version ' + ou + (jh ? ' du ' + jh : '');
}

/**
 * De quoi se compte une saisie, pour qu'on puisse COMPARER les deux versions
 * sans les ouvrir : « 110 éléments · 77 photos » vs « 96 éléments · 61 photos ».
 */
export function resumerSaisie(edl) {
  const pieces = (edl && Array.isArray(edl.pieces)) ? edl.pieces : [];
  let elements = 0, renseignes = 0, photos = 0;
  for (const p of pieces) {
    const els = (p && Array.isArray(p.elements)) ? p.elements : [];
    for (const e of els) {
      elements++;
      if ((e.etatE && e.etatE !== '') || (e.etatS && e.etatS !== '') || e.obsE || e.obsS) renseignes++;
      photos += ((e.photosE || []).length + (e.photosS || []).length);
    }
  }
  return { elements, renseignes, photos };
}

const estSigne = e => !!(e && e.signatures && (e.signatures.signedAt || e.signatures.locked));

/**
 * Sur conflit de version d'un enregistrement `edl`, la règle « le serveur
 * gagne » NE S'APPLIQUE PLUS : la version locale est conservée comme une
 * SECONDE LIGNE de la liste, nommée et datée. La version serveur est acceptée
 * normalement. L'utilisateur compare, garde celle qu'il veut, supprime l'autre.
 *
 * Ce qui est garanti ici :
 *   - **rien n'est fusionné** (invariant 32) ;
 *   - **rien n'est supprimé** — ni la version serveur, ni la locale ;
 *   - la copie reçoit un identifiant NEUF, donc elle remontera par un INSERT,
 *     qui ne peut pas entrer en conflit à son tour (invariant 34) ;
 *   - un EDL SIGNÉ n'est jamais dupliqué : il est immuable côté synchro
 *     (`store-sync.js`) et ne peut donc pas conflicter — la garde est
 *     défensive, deux EDL signés pour une même visite seraient absurdes ;
 *   - **aucune collection autre que `edl` n'est touchée** (invariant 33).
 *
 * @param {object}   opt.dbCloud   le DB fraîchement hydraté (le serveur gagne, pour lui)
 * @param {Array}    opt.edlsLocaux la liste `DB.edl` AVANT remplacement
 * @param {Set|Array} opt.clesEnConflit les clés rendues par le moteur (summary.conflicts)
 * @param {Function} opt.cleDe     record → clé d'identité (fournie par store-sync : on ne la recopie pas)
 * @param {Function} opt.nouvelId  fabrique d'identifiant local neuf (nid() de l'app)
 * @returns {{db:object, conserves:Array<{idOrigine:*, idNouveau:*, nom:string, resume:object}>}}
 */
export function conserverLesDeuxVersions({
  dbCloud, edlsLocaux = [], clesEnConflit = [], cleDe, nouvelId, maintenant = Date.now(),
} = {}) {
  // Le défaut de déstructuration ne couvre QUE `undefined` : un `maintenant`
  // valant 0, NaN ou une chaîne aurait daté la version conservée de 1970, et
  // c'est cette date qui la nomme à l'écran (« version tablette du 01/01 »).
  const now = Number(maintenant);
  maintenant = Number.isFinite(now) && now > 0 ? now : Date.now();
  const db = (dbCloud && typeof dbCloud === 'object') ? dbCloud : {};
  const cles = clesEnConflit instanceof Set ? clesEnConflit : new Set(clesEnConflit || []);
  if (!cles.size || typeof cleDe !== 'function' || typeof nouvelId !== 'function') {
    return { db, conserves: [] };
  }
  const locaux = Array.isArray(edlsLocaux) ? edlsLocaux : [];
  const conserves = [];
  const copies = [];
  for (const local of locaux) {
    if (!vivant(local) || local.id == null) continue;
    let k = null;
    try { k = cleDe(local); } catch (_e) { k = null; }
    if (k == null || !cles.has(k)) continue;
    if (estSigne(local)) continue;                       // ne peut pas conflicter (immuable)
    const m = marqueAppareil(local);
    const quand = (m && m.quand) || Date.parse(local._modifiedAt || '') || maintenant;
    const nom = nomVersionConservee(local, m ? m.nom : 'cet appareil', quand);
    const idNeuf = nouvelId();
    // Copie de surface + retrait des marqueurs de synchro : sans ça la copie
    // hériterait de la version trackée de l'original et repartirait en UPDATE
    // — donc en conflit, exactement ce qu'on est en train de désamorcer.
    const copie = Object.assign({}, local, {
      id: idNeuf,
      _versionConservee: { idOrigine: local.id, appareil: m ? m.nom : '', quand, nom },
      _modifiedAt: new Date(maintenant).toISOString(),
    });
    // ⚠️ `_espaceId` est CONSERVÉ — corrigé après audit. Le premier jet le
    // supprimait en pensant que la réadoption D1b le reposerait ; c'est faux :
    // `_adoptTags` ne réadopte que sur une clé NUE déjà connue de la baseline,
    // et la copie porte un identifiant NEUF. Sans son tag, une version conservée
    // d'un EDL de SCI PARTAGÉE était routée vers l'espace propre, sa clé
    // étrangère « logement » n'y résolvait pas, et elle restait donc « skipped »
    // à chaque envoi, indéfiniment — pendant que la bannière affirmait « ta
    // saisie est conservée ». Elle l'était : sur ce seul appareil.
    // Un identifiant neuf dans le MÊME espace ne peut pas heurter un tombstone :
    // l'insertion passe, la clé étrangère résout, l'invariant 34 est mieux servi.
    copies.push(copie);
    conserves.push({ idOrigine: local.id, idNouveau: idNeuf, nom, resume: resumerSaisie(local) });
  }
  if (!copies.length) return { db, conserves: [] };
  const edlCloud = Array.isArray(db.edl) ? db.edl : [];
  return { db: Object.assign({}, db, { edl: edlCloud.concat(copies) }), conserves };
}

/** Le message qui annonce ce qui vient d'être conservé — jamais un silence. */
export function messageVersionsConservees(conserves) {
  const n = (conserves || []).length;
  if (!n) return '';
  const c = conserves[0];
  const r = c.resume || {};
  const detail = n === 1
    ? '« ' + c.nom +' » (' + r.elements + ' éléments · ' + r.photos + ' photos)'
    : n + ' versions locales';
  return 'Une modification concurrente a été reçue. La saisie n’a PAS été écrasée : '
    + detail + ' est conservée à côté de la version reçue. '
    + 'Comparer les deux, garder celle voulue, supprimer l’autre — rien n’a été fusionné.';
}
