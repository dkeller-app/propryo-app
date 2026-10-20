/**
 * core/loyer-bareme.js — AUDIT-SUIVI-LOYERS étape 2 (2026-07-15) : le noyau PUR qui
 * construit et fait évoluer DB.loyerBareme[] (source de vérité du loyer dans le temps).
 *
 * Une période = {ref, debut, fin|null, hc, ch, source:'bail'|'irl'|'manuel'|'cloture',
 * bailDebut, note, _deleted?}. Append-only + tombstones (transite par le blob espace_config
 * comme irlHistorique — aucune table relationnelle). Consommé en lecture par duMois()
 * (loyer-du-mois.js), qui filtre les tombstones et lit `fin` sur chaque période.
 *
 * DÉCISION Q1 (user 14/07) : chaque révision IRL porte une DATE D'EFFET EXPLICITE, jamais
 * rétroactive, jamais avant un mois déjà quittancé (le passé quittancé ne se recalcule jamais).
 * Pré-remplissage : validée avant/au 1er anniversaire de l'année → effet au 1er du mois de
 * l'anniversaire ; validée après → 1er du mois suivant la validation. Modifiable, re-validée
 * par les mêmes garde-fous (clampDateEffet).
 *
 * Fonctions PURES (aucune lecture de DB) — testées : __tests__/helpers/loyer-bareme.test.js.
 */
import { finOccupationBail } from './fin-occupation.js';

const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _ymd = (iso) => String(iso == null ? '' : iso).slice(0, 10);

/** '2026-03-15' | '2026-03' → '2026-03-01'. */
export function _premierDuMois(iso) {
  const s = String(iso == null ? '' : iso);
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : '';
}

/** '2026-06-20' → '2026-07-01' (franchit l'année). */
export function _premierDuMoisSuivant(iso) {
  const p = _premierDuMois(iso);
  if (!p) return '';
  let y = parseInt(p.slice(0, 4), 10);
  let m = parseInt(p.slice(5, 7), 10) + 1;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/**
 * IRL-REVISION R1/R2 — jamais de révision en cours de mois : une date qui n'est pas un 1er
 * est reportée au 1er du mois SUIVANT (jamais avancée). '2026-09-15' → '2026-10-01' ;
 * '2026-09-01' → inchangé.
 */
export function _premierDuMoisOuSuivant(iso) {
  const d = _ymd(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return d.slice(8, 10) === '01' ? d : _premierDuMoisSuivant(d);
}

/**
 * « Montant réellement saisi » — CDC Finances §M-1 bis : l'app ne devine rien. Un champ VIDE
 * n'est pas un zéro, et un zéro doit être une SAISIE EXPLICITE.
 *
 * Ce qui se passait sans cette distinction (mesuré le 2026-08-20) : `''` passe le test
 * `!= null` puis `Number('') || 0` vaut 0 — la provision du barème tombait à 0 € pour tous les
 * mois suivants, à la première révision IRL comme au premier enregistrement du bail.
 * Le producteur de cet état est openAnnonce (index.html) : il prenait une RÉFÉRENCE VIVANTE
 * sur DB.baux[ref] et y écrivait `bail.ch = log.chargesRef || log.ch || ''` — ouvrir la modale
 * « Annonce » modifiait donc le bail en base. (Le fichier de référence importé, lui, écrit
 * `parseFloat(...)||0`, donc un 0 : il ne produit pas de chaîne vide.)
 *
 * @param {*} v valeur brute (champ de formulaire, cellule importée, valeur stockée)
 * @returns {number|null} le nombre saisi, ou null si rien ne l'a été
 */
export function montantSaisi(v) {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Premier montant réellement saisi de la chaîne des sources (bail → lot → barème en vigueur).
 * Rend null si AUCUNE source ne sait : c'est à l'appelant d'assumer son plancher, pas au
 * helper d'inventer un 0.
 */
export function premierMontantSaisi(...candidats) {
  for (const c of candidats) {
    const n = montantSaisi(c);
    if (n != null) return n;
  }
  return null;
}

/** Lendemain d'une date ISO. */
function _lendemain(iso) {
  const d = new Date(_ymd(iso) + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Veille d'une date ISO. */
function _veille(iso) {
  const d = new Date(_ymd(iso) + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Applique les garde-fous Q1 à une date d'effet (pré-remplie OU saisie par l'utilisateur) :
 *   1. jamais avant le 1er du mois de l'anniversaire de l'année en cours ;
 *   2. jamais avant/dans un mois déjà quittancé (effet ≥ 1er du mois SUIVANT le dernier quittancé) ;
 *   3. jamais avant le DÉBUT DU BAIL qu'elle modifie (audit 2026-08-24).
 *
 * Le point 3 rend INATTEIGNABLE la ceinture muette d'appliquerNouvellePeriode (`debut < bailDebut`
 * → `return arr`). Mesuré sans lui : une révision datée avant le bail courant était refusée EN
 * SILENCE par le barème pendant que `log.hc` et `DB.baux[ref].hc`, eux, étaient bien mis à jour —
 * l'enregistrement suivant repeignait alors la période du bail au tarif de la révision fantôme
 * (172 mois, 26 088 € sur 4 051 séquences). Un refus muet dans le module, une divergence dans les
 * données : exactement ce que ce chantier combat.
 *
 * Normalise toujours au 1er du mois, SAUF quand c'est le début du bail qui borne (un bail peut
 * commencer le 15 ; la période prend alors effet ce jour-là, duMois proratise déjà).
 * `ajustee` = la date a dû être remontée (à signaler dans l'UI).
 * @param {string} effetIso date d'effet proposée
 * @param {{annivMoisPremierIso?:string, demandeIso?:string, dernierMoisQuittanceYm?:string, debutBailIso?:string}} opts
 * @returns {{effetIso:string, ajustee:boolean}}
 */
export function clampDateEffet(effetIso, opts) {
  const o = opts || {};
  // IRL-REVISION (décision Didier 25/09) — `libre` : la date SAISIE par l'utilisateur est son choix.
  // Le jour est conservé (pas de ramenée au 1er ; « mois entiers conseillés » est dit par l'écran,
  // jamais imposé) et la demande ne borne pas. Restent INTANGIBLES : la date de révision du cycle,
  // le dernier mois quittancé (I-1) et le début du bail.
  const _libre = !!o.libre && /^\d{4}-\d{2}-\d{2}$/.test(_ymd(effetIso));
  let effet = _libre ? _ymd(effetIso) : _premierDuMois(effetIso);
  const propose = effet;
  const annivMin = o.annivMoisPremierIso ? _premierDuMois(o.annivMoisPremierIso) : '';
  if (annivMin && effet < annivMin) effet = annivMin;
  // IRL-REVISION R2 — art. 17-1 : la révision « prend effet à compter de sa demande ». Une
  // date d'effet ne précède donc jamais la demande (1er du mois qui la suit, sauf demande un 1er).
  // Décision Didier 25/09 (2ᵉ temps) — « on ne revient pas en arrière » : même en date libre, jamais
  // avant la DEMANDE, au jour près (art. 17-1 : la révision « prend effet à compter de sa demande »).
  const demandeMin = o.demandeIso
    ? (_libre ? _ymd(o.demandeIso) : _premierDuMoisOuSuivant(o.demandeIso)) : '';
  if (demandeMin && effet < demandeMin) effet = demandeMin;
  if (o.dernierMoisQuittanceYm) {
    const minLibre = _premierDuMoisSuivant(o.dernierMoisQuittanceYm + '-01');
    if (minLibre && effet < minLibre) effet = minLibre;
  }
  const debutBail = o.debutBailIso ? _ymd(o.debutBailIso) : '';
  if (debutBail && effet < debutBail) effet = debutBail;
  return { effetIso: effet, ajustee: effet !== propose };
}

/**
 * Pré-remplit la date d'effet d'une révision IRL (Q1) puis applique les garde-fous.
 * @param {{anniversaireIso:string, validationIso:string, dernierMoisQuittanceYm?:string}} input
 * @returns {{effetIso:string, ajustee:boolean}}
 */
export function computeDateEffetIRL(input) {
  const i = input || {};
  const anniv = _ymd(i.anniversaireIso);
  const validation = _ymd(i.validationIso);
  // IRL-REVISION R1 — la date de révision est un 1er ; une date anniversaire en cours de mois
  // est REPORTÉE au 1er du mois suivant (ex-D12 l'avançait au 1er du mois courant).
  const annivMoisPremier = _premierDuMoisOuSuivant(anniv);
  // R2 — validée avant/au jour de la date de révision → effet à cette date ; validée après →
  // à compter de la demande : le 1er du mois qui la suit (le jour même si c'est un 1er).
  const propose = (validation && annivMoisPremier && validation > annivMoisPremier)
    ? _premierDuMoisOuSuivant(validation)
    : annivMoisPremier;
  return clampDateEffet(propose, { annivMoisPremierIso: annivMoisPremier, demandeIso: validation || undefined, dernierMoisQuittanceYm: i.dernierMoisQuittanceYm });
}

/**
 * Audit M1 — la règle de date d'effet EN VIGUEUR AVANT IRL-REVISION (Q1 du 14/07), conservée pour
 * RELIRE l'historique : la reconstruction du barème (loyer-migration.js) re-date les révisions
 * anciennes sans date d'effet avec la règle sous laquelle elles ont été faites. La nouvelle règle
 * (R1/R2 ci-dessus) ne s'applique qu'aux révisions validées désormais — jamais rétroactivement
 * au passé, qui fait foi.
 */
export function computeDateEffetIRLHistorique(input) {
  const i = input || {};
  const anniv = _ymd(i.anniversaireIso);
  const validation = _ymd(i.validationIso);
  const annivMoisPremier = _premierDuMois(anniv);
  const propose = (validation && anniv && validation > anniv)
    ? _premierDuMoisSuivant(validation)
    : annivMoisPremier;
  return clampDateEffet(propose, { annivMoisPremierIso: annivMoisPremier, dernierMoisQuittanceYm: i.dernierMoisQuittanceYm });
}

/** Période initiale à la création d'un bail (source 'bail', fin ouverte). */
export function periodeInitialeBail(bail) {
  if (!bail || !bail.debut) return null;
  const debut = _ymd(bail.debut);
  return {
    ref: bail.ref, debut, fin: null,
    hc: Number(bail.hc) || 0, ch: Number(bail.ch) || 0,
    source: 'bail', bailDebut: debut, note: ''
  };
}

/**
 * Période vivante OUVERTE (fin==null) du lot, la plus tardive, filtrée par `ok(p)` (ref tolérante).
 * Base commune des trois sélecteurs du module — une seule boucle, un seul comportement.
 */
/**
 * Deux lignes appartiennent-elles au MÊME chapitre (même bail) ? `bailDebut` absent = barème
 * antérieur au champ : on ne peut RIEN conclure, donc on ne se sert pas du chapitre pour
 * exclure (même politique que provisionPourRevision dans loyer-du-mois.js).
 */
function _memeChapitre(p, bailDebut) {
  const b = _ymd(p && p.bailDebut);
  return !b || !bailDebut || b === bailDebut;
}

/** Indices de TOUTES les périodes vivantes ouvertes (fin==null) du lot (ref tolérante). */
function _openPeriodIdxs(periods, ref) {
  const want = _nr(ref);
  const out = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (!p || p._deleted || _nr(p.ref) !== want || p.fin != null) continue;
    out.push(i);
  }
  return out;
}

function _openPeriodIdxWhere(periods, ref, ok) {
  let idx = -1, best = '';
  for (const i of _openPeriodIdxs(periods, ref)) {
    const p = periods[i];
    if (ok && !ok(p)) continue;
    const d = _ymd(p.debut);
    if (d >= best) { best = d; idx = i; }
  }
  return idx;
}

/** Période vivante ouverte (fin==null) du lot dont le début est ≤ dateLimite (ref tolérante). */
function _openPeriodIdx(periods, ref, dateLimite) {
  return _openPeriodIdxWhere(periods, ref, dateLimite ? (p) => _ymd(p.debut) <= dateLimite : null);
}

/**
 * Ajoute une nouvelle période et clôture la période ouverte précédente du même lot à la veille
 * du nouveau début. PUR (retourne un nouveau tableau, copies des objets modifiés).
 * Idempotent : une période vivante identique (ref+debut+FIN+source+hc+ch+bailDebut) existe déjà
 * → no-op. CE QUE CETTE IDEMPOTENCE PROTÈGE (corrigé le 2026-08-24) : la même écriture rejouée —
 * double validation d'une correction, re-validation d'une révision au même montant, fusion de
 * deux appareils par le blob cloud. Elle NE protège PAS d'un rejeu au démarrage : contrairement
 * à ce que disait ce commentaire, `_applyPendingIRLRevisions` (index.html) n'écrit JAMAIS le
 * barème — il ne touche que log.hc, DB.baux[ref].hc et ses drapeaux.
 *
 * AUDIT 2026-08-24 (I4) — la clé d'idempotence ne contenait PAS `fin` : corriger uniquement la
 * date de fin d'une période était un no-op COMPLET, avec toast « Période corrigée » et entrée
 * d'audit. La saisie était perdue et l'écran disait le contraire. `fin` entre donc dans la clé,
 * comparée à la fin EFFECTIVEMENT calculée (borne comprise) — sinon un rejeu de boot, dont la
 * période a depuis été bornée par une suivante, ne serait plus idempotent et empilerait un
 * tombstone à chaque démarrage.
 *
 * @param {Array} periods barème courant
 * @param {{ref, debut, fin?, hc, ch, source, bailDebut?, note?}} nouvelle
 */
/**
 * REPRISE — la période `q` que l'on vient de couper (split) ou de remplacer (supersession)
 * courait au-delà de la nouvelle : sa tranche restante repart au lendemain de `fin`, AVEC SON
 * PROPRE TARIF. Rien n'est perdu, rien n'est doublé. Ne fait rien si la nouvelle période court
 * jusqu'au bout (fin null), si `q` s'arrêtait avant, ou si la reprise mordrait sur la période
 * suivante (barème déjà chevauchant en entrée).
 */
function _reprendreApres(arr, q, fin, suivante) {
  if (fin == null) return;
  const qFin = q.fin == null ? null : _ymd(q.fin);
  if (qFin != null && qFin <= fin) return;
  const reprise = _lendemain(fin);
  if (suivante && reprise >= suivante) return;
  const copie = { ...q, debut: reprise, fin: qFin };
  delete copie._deleted;
  delete copie._remplaceePar;
  arr.push(copie);
}

export function appliquerNouvellePeriode(periods, nouvelle) {
  const arr = (periods || []).map((p) => ({ ...p }));
  if (!nouvelle || !nouvelle.debut) return arr;
  const debut = _ymd(nouvelle.debut);
  const want = _nr(nouvelle.ref);
  const src = nouvelle.source || 'manuel';
  const hc = Number(nouvelle.hc) || 0;
  const ch = Number(nouvelle.ch) || 0;
  const bd = (nouvelle.bailDebut != null && _ymd(nouvelle.bailDebut)) ? _ymd(nouvelle.bailDebut) : debut;
  // `bailDebut` BORNE DES DEUX CÔTÉS (règle du projet) : d'où viennent les voisines ET où
  // atterrit celle qu'on pose. Une période datée AVANT le bail auquel on la rattache
  // appartiendrait au bail précédent — l'écrire chevaucherait le chapitre d'à côté.
  //
  // CEINTURE, PAS MESSAGE : un `return` nu est un échec muet, et le silence est pire qu'un
  // refus. Ce chemin doit rester INATTEIGNABLE depuis l'écran, et il l'est par construction :
  // le seul écrivain dont la date est libre (_histoSaveCorrPeriode) résout son chapitre par
  // `chapitrePour` — qui rend le chapitre de la période qu'on corrige ou celui du bail qui
  // occupe la date, jamais un chapitre postérieur à elle — puis refuse À VOIX HAUTE si la date
  // précède le bail. Les deux autres (popup de modification, révision IRL) partent d'une date
  // d'effet clampée. Vérifié par __tests__/helpers/bareme-composition-savebail.test.js.
  if (debut < bd) return arr;
  // UNE PÉRIODE DÉRIVÉE DU BAIL NE BORNE JAMAIS UNE DÉCISION DATÉE (audit 2026-08-24, cause
  // racine de B1/I1). Une période `source:'bail'` du même chapitre n'est pas une décision de
  // l'utilisateur : c'est la CONTINUATION du loyer du bail, posée par la garantie de couverture
  // ou par la reprise d'une période coupée (_reprendreApres). La laisser jouer « la suivante »
  // bornait la période qu'on écrit — mesuré à l'écran sur MUL-002 : une correction 05/2026→12/2029
  // laissait une reprise ouverte au 01/01/2030 ; l'augmentation validée ensuite s'y arrêtait et le
  // loyer retombait au tarif d'avant en 2030, POUR TOUJOURS. Ces continuations sont donc écartées
  // du calcul de la borne, puis SUPERSÉDÉES plus bas si la nouvelle période les recouvre. Une
  // révision IRL ou une correction manuelle, elles, bornent toujours : ce sont des décisions.
  const _derivee = (q) => (q.source || 'bail') === 'bail' && _memeChapitre(q, bd);
  // Borne : début de la prochaine DÉCISION datée du lot (calculée AVANT toute supersession —
  // celle-ci ne touche que des périodes au MÊME début, jamais « la suivante »).
  // AUDIT 2026-08-20 — INVARIANT DU MODULE : un lot n'a jamais deux périodes ouvertes.
  // Une période INTERCALAIRE (révision rétro-datée, correction) restait ouverte À CÔTÉ de celle
  // qui la suit : _periodeAt retenant la plus tardive dont le début est passé, le dû divergeait.
  const suivante = arr
    .filter((q) => q && !q._deleted && _nr(q.ref) === want && _ymd(q.debut) > debut && !_derivee(q))
    .map((q) => _ymd(q.debut))
    .sort()[0];
  const borne = suivante ? _veille(suivante) : null;
  // La borne est un DÉFAUT, pas une règle : une fin EXPLICITE fournie par l'appelant fait foi
  // (correction de période avec date de fin saisie). Sans cette distinction, la fin demandée
  // était silencieusement remplacée par la borne — cloturerPeriodeParDebut exige `fin == null`
  // et devenait un no-op, donc 9 mois surfacturés sur le cas mesuré. Une fin explicite plus
  // TARDIVE que la borne reste ramenée à la borne : deux périodes ouvertes restent interdites.
  let finExplicite = nouvelle.fin != null && _ymd(nouvelle.fin) ? _ymd(nouvelle.fin) : null;
  // Une fin ANTÉRIEURE au début est un non-sens : on l'ignore plutôt que d'écrire une période
  // impossible. cloturerPeriodeParDebut porte déjà ce garde ; l'appelant UI aussi — mais
  // l'invariant doit tenir dans le MODULE, pas reposer sur la discipline de qui l'appelle.
  if (finExplicite != null && finExplicite < debut) finExplicite = null;
  const fin = finExplicite != null
    ? (borne && finExplicite > borne ? borne : finExplicite)
    : borne;
  // Idempotence : la même période vivante, FIN COMPRISE, est déjà là ?
  if (arr.some((p) => p && !p._deleted && _nr(p.ref) === want && _ymd(p.debut) === debut
    && p.source === src && (Number(p.hc) || 0) === hc && (Number(p.ch) || 0) === ch
    && (p.fin == null ? null : _ymd(p.fin)) === fin && _memeChapitre(p, bd))) return arr;
  // MÊME DATE DE DÉBUT, MÊME CHAPITRE — la nouvelle SUPERSÈDE l'ancienne. Deux révisions
  // validées pour la même date d'effet (on corrige le montant puis on revalide) laissaient DEUX
  // périodes ouvertes au même jour : reproduit à l'écran le 2026-08-20 via _applyIRLValidated
  // appelé deux fois sur 2026-09-01 (730 puis 742). Ni la clôture « à la veille » ni la borne
  // sur la suivante ne peuvent traiter ce cas — l'une donnerait fin < debut, l'autre ne voit que
  // les débuts STRICTEMENT postérieurs.
  //
  // AUDIT 2026-08-24 (I1) — le filtre ne regardait que (ref, debut) : une écriture du chapitre
  // 2024-01-01 datée au 01/01/2023 SUPPRIMAIT la période du bail précédent, qui n'a rien à voir
  // avec elle. `borneMinEffetBareme` protège la popup de modification du bail, PAS « Corriger une
  // période » où la date est libre. Le chapitre entre donc dans le filtre. Un `bailDebut` ABSENT
  // (barème antérieur au champ) reste superséé : c'est précisément le stock legacy que bc4efdf
  // devait protéger, et on ne peut rien conclure de son chapitre.
  //
  // AUDIT 2026-08-24 (I2) — le commentaire précédent affirmait « la ligne reste dans l'historique,
  // _baremeOfLot la filtre ». C'était FAUX côté écran : construireHistoriqueBail filtre lui aussi
  // `_deleted` (js/core/bail-historique.js), donc la ligne remplacée DISPARAISSAIT de la timeline —
  // une saisie détruite en silence, exactement ce que ce chantier combat. Le tombstone porte
  // désormais sa raison (`_remplaceePar`), et la timeline en fait un événement.
  for (let i = 0; i < arr.length; i++) {
    const q = arr[i];
    if (!q || q._deleted || _nr(q.ref) !== want || _ymd(q.debut) !== debut) continue;
    if (!_memeChapitre(q, bd)) continue;
    arr[i] = { ...q, _deleted: true, _remplaceePar: { hc, ch, source: src, fin } };
    // La remplacée couvrait PLUS LOIN que la nouvelle (on corrige janvier-mars d'une période qui
    // courait jusqu'en décembre) : le reste n'a pas disparu pour autant, il reprend au lendemain
    // avec SON tarif. Sans cette reprise, la fenêtre libérée retombait sur le repli « bail », donc
    // sur le tarif d'aujourd'hui appliqué au passé (mesuré : 14 séquences, 316 mois découverts).
    _reprendreApres(arr, q, fin, suivante);
  }
  // La période EN VIGUEUR au nouveau début lui cède la place. Elle n'était cherchée que parmi
  // les périodes OUVERTES : poser une correction À L'INTÉRIEUR d'une période FERMÉE ne la coupait
  // pas, les deux se chevauchaient, et le dû dépendait alors de l'ORDRE DU TABLEAU — donc de
  // l'appareil (le blob cloud réordonne). Le cas devient courant depuis que la garantie de
  // couverture écrit des segments fermés ; mesuré : 603 couples chevauchants sur 4 096 séquences.
  // Une période coupée est SPLITTÉE, pas rognée : la tranche d'avant s'arrête à la veille, la
  // tranche d'après reprend LE MÊME TARIF au lendemain de la nouvelle. Rien n'est perdu.
  let enVigueur = -1, plusTardif = '';
  for (let i = 0; i < arr.length; i++) {
    const q = arr[i];
    if (!q || q._deleted || _nr(q.ref) !== want) continue;
    const qd = _ymd(q.debut);
    if (qd >= debut) continue;
    if (q.fin != null && _ymd(q.fin) < debut) continue;
    if (qd >= plusTardif) { plusTardif = qd; enVigueur = i; }
  }
  if (enVigueur >= 0) {
    const q = arr[enVigueur];
    arr[enVigueur] = { ...q, fin: _veille(debut) };
    _reprendreApres(arr, q, fin, suivante);
  }
  // Les continuations DÉRIVÉES que la nouvelle période RECOUVRE cèdent la place : à partir de sa
  // date d'effet, c'est SON tarif qui vaut, plus la continuation du bail. Sans quoi la dérivée
  // survivait EN CHEVAUCHEMENT (dû dépendant de l'ordre du tableau) et rallumait la borne au
  // prochain passage. Une décision datée, elle, n'entre pas dans `_derivee` : elle survit.
  for (let i = 0; i < arr.length; i++) {
    const q = arr[i];
    if (!q || q._deleted || _nr(q.ref) !== want || !_derivee(q)) continue;
    const qd = _ymd(q.debut);
    if (qd <= debut) continue;                       // avant/au nouveau début : géré par enVigueur
    if (fin != null && qd > fin) continue;           // au-delà de la nouvelle période : intacte
    arr[i] = { ...q, _deleted: true, _remplaceePar: { hc, ch, source: src, fin } };
    // SYMÉTRIE avec les deux autres découpes (même-début, split en vigueur) — audit
    // 2026-08-25 : cette boucle supprimait EN BLOC une continuation dérivée que la nouvelle
    // période ne recouvre que PARTIELLEMENT (la reprise finit APRÈS `fin`), perdant sa queue →
    // trou intérieur → repli « bail » → l'infraction I-1 que _reprendreApres existe justement
    // pour empêcher, réintroduite par le seul chemin de découpe qui l'oubliait. La queue
    // reprend au lendemain de `fin`, avec le tarif de la reprise. (fin==null ⇒ la nouvelle
    // recouvre tout : _reprendreApres ne fait rien, c'est bien « recouvre entièrement ».)
    _reprendreApres(arr, q, fin, suivante);
  }
  arr.push({
    ref: nouvelle.ref, debut, fin, hc, ch, source: src,
    bailDebut: bd,
    note: nouvelle.note || ''
  });
  return arr;
}

/**
 * RÉ-ANCRAGE — la date de début d'un bail vient de changer. `debut` n'est pas un terme financier
 * (CHAMPS_FINANCIERS = hc/ch/dg) : aucune popup ne s'interpose, et sans ce geste les périodes du
 * bail gardaient l'ancien `bailDebut`. Elles devenaient « étrangères » à leur propre bail, se
 * faisaient clôturer, et une révision IRL programmée était éteinte par la porte de service.
 *
 * PUR, et volontairement PAUVRE : on ne touche QUE l'étiquette `bailDebut` — plus le `debut` de la
 * période la plus ancienne quand le bail RECULE, sans quoi les mois entre les deux dates n'ont
 * plus de période et duMois retombe sur le repli « bail », c'est-à-dire le tarif d'aujourd'hui
 * appliqué au passé. AUCUN MONTANT NE BOUGE, aucune période n'est créée ni clôturée : cette
 * fonction est appelable sur les DEUX branches de saveBail (avec ou sans popup) sans risque.
 */
export function reancrerPeriodesDuBail(periods, ref, debutPrecedent, debutNouveau) {
  const arr = (periods || []).map((p) => ({ ...p }));
  const prec = _ymd(debutPrecedent);
  const debut = _ymd(debutNouveau);
  if (!prec || !debut || prec === debut) return arr;
  const want = _nr(ref);
  let plusAncienne = -1;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (!p || p._deleted || _nr(p.ref) !== want || _ymd(p.bailDebut) !== prec) continue;
    // Une période entièrement ANTÉRIEURE au nouveau début n'appartient plus à ce bail : la
    // ré-étiqueter la ferait apparaître sous lui dans la timeline alors qu'elle le précède.
    if (p.fin != null && _ymd(p.fin) < debut) continue;
    arr[i] = { ...p, bailDebut: debut };
    if (plusAncienne < 0 || _ymd(arr[i].debut) < _ymd(arr[plusAncienne].debut)) plusAncienne = i;
  }
  if (plusAncienne >= 0 && debut < _ymd(arr[plusAncienne].debut)) {
    // NON BORNÉ, DÉLIBÉRÉMENT (audit 2026-08-24) : reculer la date de début d'un bail au-delà de
    // la dernière période du locataire PRÉCÉDENT étend cette période par-dessus la sienne — un
    // chevauchement, donc un dû qui dépend de l'ordre du tableau. Un plancher a été essayé puis
    // RETIRÉ : il transformait le geste en no-op SILENCIEUX, ce qui est pire qu'un refus. Le
    // traitement juste est un REFUS PARLANT dans saveBail (« ce bail commencerait avant la fin du
    // bail précédent »), qui n'appartient pas au périmètre de ce chantier. Consigné en suite.
    arr[plusAncienne] = { ...arr[plusAncienne], debut };
  }
  return arr;
}

/**
 * Les tranches de [debut, jusquAu] qu'AUCUNE période vivante du lot ne couvre — la brique de la
 * garantie de couverture. Ne lit rien, n'écrit rien : elle DIT où sont les trous. PUR.
 *
 * `jusquAu` (optionnel) est l'HORIZON : jusqu'où on a besoin de geler. Les écrivains DATÉS le
 * fournissent (la veille de leur date d'effet) — au-delà, c'est la période qu'ils s'apprêtent à
 * écrire qui fait foi, et poser quoi que ce soit là-bas la bornerait. Sans horizon, le dernier
 * segment est OUVERT ; s'il existe déjà une période ouverte, elle couvre tout le reste.
 * @returns {Array<{debut:string, fin:string|null}>}
 */
export function _segmentsManquants(periods, ref, debut, jusquAu) {
  const want = _nr(ref);
  const vivantes = (periods || [])
    .filter((q) => q && !q._deleted && _nr(q.ref) === want && q.debut)
    .map((q) => ({ debut: _ymd(q.debut), fin: q.fin == null ? null : _ymd(q.fin) }))
    .sort((a, b) => a.debut.localeCompare(b.debut));
  const segs = [];
  let curseur = _ymd(debut);
  if (!curseur) return segs;
  const horizon = _ymd(jusquAu) || null;
  const pousser = (d, f) => {
    if (horizon && d > horizon) return;                              // au-delà : rien à geler
    segs.push({ debut: d, fin: f == null ? horizon : (horizon && f > horizon ? horizon : f) });
  };
  for (const q of vivantes) {
    if (q.fin == null) {
      // Une période ouverte couvre tout ce qui suit son début : le seul trou possible est
      // AVANT elle.
      if (q.debut > curseur) pousser(curseur, _veille(q.debut));
      return segs;
    }
    if (q.fin < curseur) continue;                                   // entièrement derrière nous
    if (q.debut > curseur) pousser(curseur, _veille(q.debut));
    curseur = _lendemain(q.fin);
  }
  pousser(curseur, null);
  return segs;
}

/**
 * Synchronise le barème avec le bail courant à chaque saveBail (création OU édition). PUR.
 *
 * LA PÉRIODE DU BAIL EST CELLE QUE LE BAIL A CRÉÉE — source 'bail'. C'est la seule que cette
 * fonction a le droit de réécrire. Les révisions IRL et les corrections datées ont leur propre
 * chemin d'écriture (appliquerNouvellePeriode, appelé sous popup de validation) : elles portent
 * le tarif en vigueur ou à venir, jamais celui des champs du formulaire de bail.
 *
 * CE QUI SE PASSAIT AVANT (mesuré en prod le 2026-08-20, v15.541) : la sélection prenait « la
 * période ouverte de plus grand début », sans distinction de source. Dès qu'une révision était
 * PROGRAMMÉE pour une date future, elle était la seule période ouverte du lot — un saveBail sans
 * le moindre changement financier (un numéro de téléphone) la ramenait au tarif du bail :
 *     AVANT  2024-01-01→2026-08-31 700+100 · 2026-09-01→ouverte 730+100 [irl]
 *     APRÈS  2024-01-01→2026-08-31 700+100 · 2026-09-01→ouverte 700+100 [irl]
 * La révision disparaissait du barème et de la timeline — DÉFINITIVEMENT :
 * _applyPendingIRLRevisions (index.html) ne réécrit jamais le barème, il ne touche que log.hc,
 * DB.baux[ref].hc et ses drapeaux. Contrairement à ce qui avait été supposé au cadrage, rien ne
 * la remettait au démarrage suivant. Toute quittance émise ensuite partait au mauvais tarif.
 *
 * Aucune horloge n'entre dans la décision : le résultat d'un enregistrement ne dépend pas de
 * l'heure à laquelle on enregistre (et reste testable sans figer la date du jour).
 *
 *   - période ouverte de source 'bail' → son hc/ch suit les termes du formulaire ;
 *   - sinon, période ouverte appartenant à CE bail (même bailDebut) → on n'y touche pas ;
 *   - sinon → création de la période initiale (bail neuf, ou re-bail après clôture).
 *
 * @param {Array} periods barème courant
 * @param {{ref, debut, hc, ch}} bail
 * @param {string} [debutPrecedent] date de début du bail AVANT cette édition, quand elle change
 */
export function synchroniserPeriodeBail(periods, bail, debutPrecedent) {
  const arr = _synchroniser(periods, bail, debutPrecedent);
  if (!bail || !bail.debut) return arr;
  // GARANTIE DE COUVERTURE (audit 2026-08-24, B1) — sur TOUTES les sorties, pas seulement la
  // branche « barème refermé ». Les autres branches sortent tôt (période de bail ouverte,
  // révision programmée du même bail, barème mal refermé) et laissaient le DÉBUT du bail à
  // découvert dès qu'une écriture datée avait ouvert un trou avant elles. `_segmentsManquants`
  // ne réécrit JAMAIS ce qui existe : sur un barème déjà complet, c'est un no-op.
  return _couvrirDepuisLeDebutDuBail(arr, bail);
}

/**
 * Ajoute au barème les segments du bail qui manquent pour couvrir [bail.debut, +∞[. PUR.
 * Le tarif écrit est celui du bail — LE MÊME que celui vers lequel `duMois` retombait déjà
 * pour ces mois (repli « bail » du segment courant) : aucun montant affiché ne change au
 * moment de l'écriture. Ce qui change, c'est qu'il cesse de bouger ensuite (invariant I-1).
 * LOT 3 : un champ NON SAISI ne remplace pas une valeur connue — on reprend celle de la
 * période qui précède le trou plutôt que d'inventer un 0.
 *
 * `garantirCouvertureBail` est le point d'entrée des écrivains DATÉS (popup de modification,
 * révision IRL, correction de période) : eux ne doivent RIEN toucher de ce qui existe — ni les
 * montants d'une période ouverte, ni ses dates. Passer par synchroniserPeriodeBail ici serait
 * une régression I-1 mesurée : sa branche « la période de bail ouverte suit le formulaire »
 * repeignait les mois d'AVANT la date d'effet au tarif qu'on venait de saisir (72 mois,
 * 4 986 € sur 4 008 séquences).
 */
export function garantirCouvertureBail(periods, bail, avantLe) {
  if (!bail || !bail.debut) return (periods || []).map((p) => ({ ...p }));
  return _couvrirDepuisLeDebutDuBail((periods || []).map((p) => ({ ...p })), bail, avantLe);
}

function _couvrirDepuisLeDebutDuBail(arr, bail, avantLe) {
  const want = _nr(bail.ref);
  const debut = _ymd(bail.debut);
  const jusquAu = _ymd(avantLe) ? _veille(avantLe) : null;
  const segs = _segmentsManquants(arr, bail.ref, debut, jusquAu);
  if (!segs.length) return arr;
  const out = arr.slice();
  for (const seg of segs) {
    // LA QUEUE OUVERTE N'EST PAS UN TROU (audit 2026-08-24). Quand la dernière période vivante
    // est fermée DANS LE FUTUR (une correction longue « 2023-01-01→2027-12-31 »), le « trou »
    // qui la suit commence lui aussi dans le futur. Y poser une période ouverte au tarif
    // d'AVANT l'édition a trois effets, tous mesurés :
    //   · elle devient `suivante` et BORNE la période qu'on s'apprête à écrire → l'augmentation
    //     validée expirait au 31/12/2027 et le loyer revenait à 790 € au lieu de 870 € POUR
    //     TOUJOURS (2 880 € sur 2028-2030 par la popup, 1 512 € par la révision IRL) ;
    //   · elle gonfle `borneMinEffetBareme` → la popup repoussait la date d'effet de 17 mois
    //     avec un motif faux (1 360 € non facturés, sans recours) ;
    //   · portant source:'bail', elle offrait une cible à la branche « la période de bail
    //     ouverte suit le formulaire » → un changement de NUMÉRO DE TÉLÉPHONE la repeignait.
    // Or `duMois` résout déjà ces mois-là au tarif du bail (repli « bail ») : il n'y a rien à
    // geler APRÈS la dernière période connue, seulement AVANT. La queue n'est donc posée que
    // lorsqu'elle commence à la date du bail lui-même — bail neuf, re-bail, barème vierge :
    // là, elle EST la période du bail. Les mois entre la dernière période et la prochaine
    // écriture datée sont gelés par l'HORIZON de cette écriture, au tarif d'alors.
    if (seg.fin == null && seg.debut !== debut) continue;
    const prec = _periodeJusteAvant(out, want, seg.debut);
    const p = periodeInitialeBail(bail);
    if (!p) break;
    const hc = premierMontantSaisi(bail.hc, prec && prec.hc);
    const ch = premierMontantSaisi(bail.ch, prec && prec.ch);
    p.debut = seg.debut;
    p.fin = seg.fin;
    p.bailDebut = debut;
    p.hc = hc != null ? hc : 0;
    p.ch = ch != null ? ch : 0;
    // La trace qui manquait : un segment qui ne commence pas à la date du bail dit pourquoi.
    p.note = seg.debut === debut ? '' : 'Complété : période non couverte par le barème';
    out.push(p);
  }
  return out;
}

/** Dernière période vivante du lot qui se termine AVANT `iso` (la voisine de gauche du trou). */
function _periodeJusteAvant(arr, want, iso) {
  let hit = null;
  for (const q of arr) {
    if (!q || q._deleted || _nr(q.ref) !== want || q.fin == null) continue;
    if (_ymd(q.fin) >= _ymd(iso)) continue;
    if (!hit || _ymd(q.fin) > _ymd(hit.fin)) hit = q;
  }
  return hit;
}

function _synchroniser(periods, bail, debutPrecedent) {
  let arr = (periods || []).map((p) => ({ ...p }));
  if (!bail || !bail.debut) return arr;
  const want = _nr(bail.ref);
  const debut = _ymd(bail.debut);
  // RE-ANCRAGE (audit) — corriger la DATE DE DÉBUT du bail n'est pas un terme financier : aucune
  // popup ne s'interpose. Sans re-ancrage, les périodes de ce bail gardaient l'ancien bailDebut,
  // devenaient « étrangères » à leur propre bail, et une révision IRL programmée se faisait
  // clôturer puis remplacer par le tarif du formulaire — le défaut du LOT 2 par la porte de
  // service. Le re-ancrage est de la pure comptabilité d'étiquette : aucun montant ne bouge.
  arr = reancrerPeriodesDuBail(arr, bail.ref, debutPrecedent, debut);
  const hcSaisi = montantSaisi(bail.hc);
  const chSaisi = montantSaisi(bail.ch);
  // source absente = barème d'avant l'introduction du champ : c'est une période de bail.
  const idx = _openPeriodIdxWhere(arr, bail.ref, (p) => (p.source || 'bail') === 'bail');
  if (idx >= 0) {
    const cur = arr[idx];
    // LOT 3 — une valeur NON SAISIE ne remplace jamais une valeur connue. `pf()` rend 0 pour
    // un champ vide et un import à colonne vide pose '' : sans ce garde-fou, un simple
    // enregistrement mettait la provision (ou le loyer) du barème à 0 € pour tous les mois
    // suivants, sans popup ni avertissement. Un 0 réellement saisi, lui, écrit bien 0.
    const hc = hcSaisi != null ? hcSaisi : (montantSaisi(cur.hc) != null ? montantSaisi(cur.hc) : 0);
    const ch = chSaisi != null ? chSaisi : (montantSaisi(cur.ch) != null ? montantSaisi(cur.ch) : 0);
    if ((Number(cur.hc) || 0) === hc && (Number(cur.ch) || 0) === ch) return arr;  // idempotent
    arr[idx] = { ...cur, hc, ch };
    return arr;
  }
  // Pas de période de bail ouverte.
  //
  // RÈGLE ABSOLUE ICI : ne jamais laisser DEUX périodes ouvertes sur un lot. _periodeAt()
  // retient la plus tardive dont le début est passé — une seconde période ouverte commençant
  // AVANT elle REPEINT donc tout le passé au tarif du bail courant, ce qu'interdit
  // l'invariant I-1. Mesuré (audit du 2026-08-20, sur les modules réels) : barème
  // 2024-01-01→2026-08-31 700+100 puis 2026-09-01 ouverte 730+100 [irl] ; corriger la DATE DE
  // DÉBUT du bail (2024-01-01 → 2024-01-15) — qui n'est pas un terme financier, donc aucune
  // popup — poussait une seconde période ouverte : juin 2025 passait de 800 € à 830 €, puis à
  // 1050 € après le re-bail suivant. Trois ans de l'ancien locataire au loyer du nouveau.
  const ouvertes = _openPeriodIdxs(arr, bail.ref);
  // Une période ouverte APPARTENANT À CE BAIL (révision IRL programmée, correction datée) porte
  // le tarif à venir : on n'y touche pas, et on ne lui en oppose pas une seconde. C'est le test
  // qui compte — pas la comparaison de dates, qui fermait la révision d'un bail dont on venait
  // de reculer la date de début (audit, résidu 1a).
  if (ouvertes.some((i) => _ymd(arr[i].bailDebut) === debut)) return arr;
  if (!ouvertes.length) {
    // Aucune période ouverte : le barème du lot est refermé (correction datée bornée, clôture).
    // Créer la période du bail à sa date de début REPASSERAIT PAR-DESSUS ce qui est déjà écrit.
    // Mesuré à l'écran : après une correction 2024-01-01→2025-12-31 à 677 € validée avec motif,
    // le saveBail suivant recréait une période 2024-01-01 au loyer du bail (662 €) et duMois
    // rendait 740 € au lieu de 755 € — la correction datée, motivée et tracée était annulée par
    // un simple enregistrement. Même famille que tout ce chantier : une saisie détruite en silence.
    //
    // AUDIT 2026-08-24 (B1) — la parade était un simple DÉCALAGE au lendemain de la plus grande
    // fin vivante du lot, sans jamais vérifier qu'une période couvre RÉELLEMENT `bail.debut`.
    // Barème vierge, bail au 01/09/2023, une correction 01/01/2024→31/03/2024 : le saveBail
    // suivant (un numéro de téléphone) posait la période du bail au 01/04/2024 et laissait
    // sept→déc 2023 SANS AUCUNE période. `_periodeAt` rend null, `duMois` bascule sur le repli
    // « bail » — c'est-à-dire le tarif d'AUJOURD'HUI appliqué au passé, l'infraction I-1 exacte
    // que l'en-tête de ce module jure d'empêcher (mesuré : 2023-09 et 2023-11 passaient de 790 à
    // 870 € à la révision IRL suivante). On ne décale plus : la garantie de couverture COMPLÈTE
    // (deux segments quand la couverture est partielle), en sortie de fonction, pour toutes les
    // branches à la fois.
    return arr;
  }
  // Les périodes ouvertes restantes appartiennent à un AUTRE bail (barème mal refermé au bail
  // précédent) : on les clôture à la veille et on crée la période du bail. Une seule ouverte.
  const veilleDebut = _veille(debut);
  if (ouvertes.every((i) => _ymd(arr[i].debut) <= veilleDebut)) {
    ouvertes.forEach((i) => { arr[i] = { ...arr[i], fin: veilleDebut }; });
    const p = periodeInitialeBail(bail);
    if (p) arr.push(p);
    return arr;
  }
  // Sinon une période ouverte couvre déjà ce bail (révision IRL programmée, correction datée) :
  // elle porte le tarif à venir. On n'y touche pas, et on n'en crée surtout pas une seconde.
  return arr;
}

/**
 * LE BARÈME DU LOT S'ARRÊTE ICI — le locataire est parti le `finIso`, plus rien n'est dû après.
 * PUR. Appelée par les trois portes de sortie : « Clôturer le bail » (2 écrans) et le re-bail
 * (archiverBail, à la veille du nouveau bail).
 *
 * AUDIT 2026-08-24 (B2 + I3) — la fonction ne touchait QUE la période ouverte la plus récente,
 * et quand celle-ci commençait APRÈS la clôture elle la tombstonait puis SORTAIT, sans jamais
 * poser la fin. Deux conséquences mesurées :
 *   · le barème ne portait AUCUNE trace de la sortie du locataire (I3) ;
 *   · au re-bail, la période de l'ancien bail gardait sa fin lointaine (une révision IRL
 *     programmée au 01/09/2026 l'avait bornée là), et la période du nouveau bail était décalée
 *     jusque-là : mars→août 2026 facturés 800 € au lieu de 980 €, 1 080 € non facturés (B2).
 * Désormais : toute période vivante du lot qui déborde la clôture est RAMENÉE à `finIso`, et
 * celle qui commence après ne s'appliquera jamais — tombstonée avec sa raison (`_annuleeParCloture`,
 * repris par la timeline : plus de disparition muette).
 */
export function cloturerBareme(periods, ref, finIso) {
  const arr = (periods || []).map((p) => ({ ...p }));
  const fin = _ymd(finIso);
  if (!fin) return arr;
  const want = _nr(ref);
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (!p || p._deleted || _nr(p.ref) !== want) continue;
    if (_ymd(p.debut) > fin) { arr[i] = { ...p, _deleted: true, _annuleeParCloture: fin }; continue; }
    if (p.fin == null || _ymd(p.fin) > fin) arr[i] = { ...p, fin };
  }
  return arr;
}

/**
 * Ce qu'une clôture au `finIso` VA faire au barème du lot — pour le dire à l'écran AVANT de le
 * faire (« prévenir, pas bloquer » : un échec muet est pire qu'un refus). PUR, ne modifie rien.
 * Même parcours que cloturerBareme, une seule définition du critère.
 * @returns {{annulees:Array, tronquees:Array}}
 */
export function impactCloture(periods, ref, finIso) {
  const fin = _ymd(finIso);
  const want = _nr(ref);
  const annulees = [], tronquees = [];
  if (!fin) return { annulees, tronquees };
  for (const p of (periods || [])) {
    if (!p || p._deleted || _nr(p.ref) !== want) continue;
    if (_ymd(p.debut) > fin) annulees.push(p);
    else if (p.fin != null && _ymd(p.fin) > fin) tronquees.push(p);
  }
  return { annulees, tronquees };
}

/**
 * LE CHAPITRE (bailDebut) auquel rattacher une écriture datée sur un lot. PUR.
 *
 * AUDIT 2026-08-24 (B2) — « Corriger une période » calculait `bailDebut` par
 * `(DB.baux[ref] && DB.baux[ref].debut) || debut`. Après une clôture, `DB.baux[ref]` est un
 * TOMBSTONE : il existe, il n'a pas de `debut`, et le repli tombait sur LA DATE DE LA CORRECTION
 * ELLE-MÊME — un chapitre inventé qui ne correspond à aucun bail. La supersession, qui compare
 * les chapitres, répondait « non » : deux périodes vivantes au même jour, donc un dû qui dépend
 * de l'ordre du tableau, donc DEUX MONTANTS SUR DEUX APPAREILS (mesuré : 767 € contre 820 €).
 * L'idempotence, qui compare aussi le chapitre, ne mordait pas davantage : rejouer la même
 * correction empilait des périodes identiques.
 *
 * Ordre de résolution :
 *   1. la période vivante EN VIGUEUR à cette date — c'est elle qu'on corrige, son chapitre fait
 *      foi (y compris sur un lot dont le bail est clos : l'historique reste corrigeable) ;
 *   2. sinon le bail (courant OU archivé) qui occupe la date ;
 *   3. sinon '' — aucun bail ne couvre cette date, à l'appelant de refuser à voix haute.
 * @param {Array} periods barème
 * @param {string} ref
 * @param {string} dateIso date de l'écriture
 * @param {Array<{debut,fin,finEffective,_deleted}>} baux baux du lot (courant + archivés)
 * @returns {string} bailDebut ISO, ou ''
 */
export function chapitrePour(periods, ref, dateIso, baux) {
  const want = _nr(ref);
  const d = _ymd(dateIso);
  if (!d) return '';
  let hit = null;
  for (const p of (periods || [])) {
    if (!p || p._deleted || _nr(p.ref) !== want || !p.debut) continue;
    const pd = _ymd(p.debut);
    if (pd > d) continue;
    if (p.fin != null && _ymd(p.fin) < d) continue;
    if (!hit || pd > _ymd(hit.debut)) hit = p;
  }
  if (hit && _ymd(hit.bailDebut)) return _ymd(hit.bailDebut);
  let best = '';
  for (const b of (baux || [])) {
    if (!b || b._deleted || !b.debut) continue;
    const bd = _ymd(b.debut);
    if (bd > d) continue;
    // LA fin d'occupation (fin-occupation.js, la même que le dû) : bail archivé → sa fin ; bail COURANT
    // (`archive:false`) → sa clôture ou son DÉPART DÉCLARÉ, jamais sa fin contractuelle (une correction
    // datée après l'échéance d'un bail reconduit trouve son bail ; après le départ, plus de dû à corriger).
    const f = _ymd(finOccupationBail(b, b.archive !== false));
    if (f && f < d) continue;
    if (bd > best) best = bd;
  }
  return best;
}

/**
 * Clôture CIBLÉE par (ref, debut) — audit HISTORIQUE-BAIL-ONGLET 17/07 : le chemin « fin
 * explicite » d'une correction de période doit fermer LA période insérée, pas la période
 * ouverte la plus récente du lot (cloturerBareme), sinon la vivante se corrompt (fin < debut).
 * No-op si fin < debut ou période introuvable. PUR.
 */
export function cloturerPeriodeParDebut(periods, ref, debutIso, finIso) {
  const want = _nr(ref);
  const debut = _ymd(debutIso);
  const fin = _ymd(finIso);
  if (!debut || !fin || fin < debut) return (periods || []).map((p) => ({ ...p }));
  return (periods || []).map((p) => {
    if (p && !p._deleted && _nr(p.ref) === want && _ymd(p.debut) === debut && p.fin == null) {
      return { ...p, fin };
    }
    return { ...p };
  });
}

// RETIRÉ (audit 2026-08-24, mineur) : `tombstonerPeriodesDuBail` n'avait AUCUN appelant — ni
// dans index.html, ni dans un module — alors qu'il était exposé sur window et cité comme
// justification de la convention de tombstone par le commentaire d'appliquerNouvellePeriode.
// Une fonction qui efface le barème d'un bail entier SANS trace, atteignable depuis la console
// et documentée nulle part, n'est pas un filet : c'est une trappe. Le vrai effacement d'un
// chapitre passerait par une confirmation UI et une trace, comme le reste du chantier.
