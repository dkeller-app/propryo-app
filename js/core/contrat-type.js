/**
 * contrat-type.js — Mentions du CONTRAT TYPE de location (décret n° 2015-587 du 29 mai 2015,
 * annexe 1 « logement nu » et annexe 2 « logement meublé »), dans leur rédaction issue du
 * décret n° 2026-596 du 6 juillet 2026.
 *
 * SOURCE (Légifrance, lue le 28/09/2026) : annexes 1 et 2, « Version en vigueur à partir du
 * 01 octobre 2026 — Modifié par Décret n°2026-596 du 6 juillet 2026 - art. 1 ». Application :
 * « Conformément à l'article 3 du décret n° 2026-596, ces dispositions, dans leur rédaction
 * résultant dudit décret, entrent en vigueur le 1er octobre 2026 et s'appliquent aux contrats
 * conclus ou renouvelés à compter de cette même date. »
 *
 * Écart avec la version précédente (décret n° 2023-796, en vigueur du 01/01/2025 au 01/10/2026),
 * identique pour les deux annexes : ① téléphone portable facultatif des parties ; ② II.B
 * « Servitude de résidence principale » (art. L. 151-14-1 du code de l'urbanisme) ; ③ VIII —
 * la clause résolutoire n'est plus « le cas échéant » : texte imposé + motif « servitude » ;
 * ④ renvoi L. 351-2 → L. 831-1 CCH dans le champ du contrat type (non repris dans le bail).
 *
 * ⚠️ DEUX SORTES DE CHAÎNES, marquées chacune :
 *  · [VERBATIM] — texte officiel recopié mot pour mot ; seules les valeurs du bail sont insérées
 *    là où le modèle met […]. Ne jamais reformuler.
 *  · [RÉDACTION D'APRÈS LE MODÈLE] — là où le modèle ne donne qu'une consigne entre crochets
 *    (« [clause prévoyant …] ») : phrase rédigée avec les mots mêmes de la consigne, sans ajout
 *    de fond. La consigne source est citée en commentaire.
 *
 * VERSION DES CLAUSES D'UN BAIL (marqueur `clauseIrlV`, posé à la signature, jamais réécrit) :
 *   1 = texte d'origine ; 2 = clause 5.2 IRL révisée (IRL-REVISION, v15.679) ;
 *   3 = 2 + contrat type issu du décret n° 2026-596 ;
 *   4 = 3 + sous-titre du bail nu selon le bailleur réel (bail-duree.js, sousTitreBailNu) — en
 *       version ≤ 3, « Bailleur personne morale » quel que soit le bailleur ;
 *   5 = 4 + clauses de durée, congé et fin corrigées (BAUX-ECHUS, bail-clauses-fin.js) : reconduction
 *       du nu 3 ou 6 ans (art. 10), meublé art. 25-7, préavis art. 25-8 I, mobilité art. 25-14 / 25-15,
 *       clause pénale art. 1231-5, « autre » : louage (C. civ. 1736 à 1740).
 * Un bail signé garde la version avec laquelle il a été signé (document ré-affiché à
 * l'identique) ; un brouillon prend la version courante.
 */

export const VERSION_CLAUSES_ACTUELLE = 5;

/** Toute valeur inconnue (absente, corrompue) = texte d'origine : jamais d'invention de version. */
export function normaliserVersionClauses(v) {
  const n = Number(v);
  return (n === 2 || n === 3 || n === 4 || n === 5) ? n : 1;
}

/**
 * La version des clauses qu'un bail AFFICHE :
 *  · signé : celle posée à la signature (absente = signé avant tout changement = 1) ;
 *  · signature à distance EN COURS : celle mémorisée à l'envoi (le PDF final doit reprendre ce
 *    que le locataire a relu) ;
 *  · sinon (brouillon) : la version courante.
 */
export function versionClausesBail(b) {
  if (!b) return VERSION_CLAUSES_ACTUELLE;
  const s = b.signatures || {};
  if (s.signedAt) return normaliserVersionClauses(b.clauseIrlV);
  const rs = s.remoteSession;
  if (rs && !['completed', 'expired', 'error'].includes(rs.status)) return normaliserVersionClauses(rs.clauseIrlV);
  return VERSION_CLAUSES_ACTUELLE;
}

/** Le bail suit-il le contrat type issu du décret n° 2026-596 ? */
export function suitContratType2026(b) {
  return versionClausesBail(b) >= 3;
}

// ── II.A — Consistance du logement ────────────────────────────────────────────────────────────

/** Libellé du modèle : « surface habitable : […] m2 ». */
export const LIBELLE_SURFACE = 'Surface habitable';
/** « niveau de performance du logement : [classe du diagnostic de performance énergétique] ». */
export const LIBELLE_NIVEAU_PERFORMANCE = 'Niveau de performance du logement';

/**
 * [VERBATIM] Rappel des critères de décence énergétique. L'annexe 2 (meublé) n'écrit pas
 * « du logement » dans le a) — la différence est celle du texte officiel, conservée.
 * @param {boolean} meuble
 * @returns {string[]} une ligne par alinéa
 */
export function rappelDecence(meuble) {
  const dl = meuble ? '' : ' du logement';
  return [
    'Rappel : un logement décent doit respecter les critères minimaux de performance suivants :',
    'a) En France métropolitaine :',
    `i) A compter du 1er janvier 2025, le niveau de performance minimal${dl} correspond à la classe F du DPE ;`,
    `ii) A compter du 1er janvier 2028, le niveau de performance minimal${dl} correspond à la classe E du DPE ;`,
    `iii) A compter du 1er janvier 2034, le niveau de performance minimal${dl} correspond à la classe D du DPE.`,
    'b) En Guadeloupe, en Martinique, en Guyane, à La Réunion et à Mayotte :',
    'i) A compter du 1er janvier 2028, le niveau de performance minimal du logement correspond à la classe F du DPE ;',
    'ii) A compter du 1er janvier 2031, le niveau de performance minimal du logement correspond à la classe E du DPE.',
    'La consommation d\'énergie finale et le niveau de performance du logement sont déterminés selon la méthode du diagnostic de performance énergétique mentionné à l\'article L. 126-26 du code de la construction et de l\'habitation.'
  ];
}

// ── II.B — Destination des locaux ─────────────────────────────────────────────────────────────

/** [VERBATIM] « Le cas échéant, Servitude de résidence principale : … » (nouveauté 2026-596) —
 *  « Le cas échéant, » est la consigne du gabarit : la mention n'est imprimée que si elle s'applique. */
export const SERVITUDE_RESIDENCE_PRINCIPALE = 'Servitude de résidence principale : le logement objet du présent contrat est soumis à l\'obligation prévue à l\'article L. 151-14-1 du code de l\'urbanisme ; il est à usage exclusif de résidence principale, au sens de l\'article 2 de la loi du 6 juillet 1989 susmentionnée.';

// ── IV.A — Loyer ──────────────────────────────────────────────────────────────────────────────

/**
 * [VERBATIM, valeurs insérées] « b) Le cas échéant, Modalités particulières de fixation initiale du loyer applicables dans
 * certaines zones tendues » — les deux lignes [Oui / Non] et les montants de référence.
 * Rien si le logement n'est pas en zone tendue (le modèle dit « le cas échéant »).
 * @param {{zoneTendue:boolean, encadrement:boolean, loyerRef?:number|string, loyerRefMajore?:number|string, fmt?:(n:number)=>string}} o
 * @returns {string[]}
 */
export function lignesZoneTendue(o) {
  const x = o || {};
  if (!x.zoneTendue) return [];
  const fmt = typeof x.fmt === 'function' ? x.fmt : (n => String(n));
  const montant = v => {
    const n = Number(String(v == null ? '' : v).replace(',', '.'));
    return (v === '' || v == null || !Number.isFinite(n) || n <= 0) ? '[à compléter]' : fmt(n);
  };
  const out = [
    'Le loyer du logement objet du présent contrat est soumis au décret fixant annuellement le montant maximum d\'évolution des loyers à la relocation : Oui.',
    'Le loyer du logement objet du présent contrat est soumis au loyer de référence majoré fixé par arrêté préfectoral : ' + (x.encadrement ? 'Oui.' : 'Non.')
  ];
  if (x.encadrement) {
    out.push('Montant du loyer de référence : ' + montant(x.loyerRef) + ' €/m2 / Montant du loyer de référence majoré : ' + montant(x.loyerRefMajore) + ' €/m2.');
  }
  return out;
}

/**
 * [RÉDACTION D'APRÈS LE MODÈLE] « c) Le cas échéant, informations relatives au loyer du dernier locataire : [montant du dernier
 * loyer acquitté par le précédent locataire, date de versement et date de la dernière révision du
 * loyer] » — mention obligatoire si le précédent locataire a quitté le logement moins de 18 mois
 * avant la signature (note 9 annexe 1 / note 31 annexe 2).
 * @param {{moinsDe18:boolean, montant?:string, dateVersement?:string, dateRevision?:string, meuble?:boolean, fmtDate?:(iso:string)=>string}} o
 */
export function textePrecedentLocataire(o) {
  const x = o || {};
  const note = x.meuble ? 'note 31 annexe 2 décret n° 2015-587' : 'note 9 annexe 1 décret n° 2015-587';
  if (!x.moinsDe18) {
    return 'Le précédent locataire a quitté le logement plus de dix-huit mois avant la signature du présent bail — mention non obligatoire (' + note + ').';
  }
  const fd = typeof x.fmtDate === 'function' ? x.fmtDate : (s => s);
  const v = s => String(s == null ? '' : s).trim();
  const montant = v(x.montant) || '[à compléter]';
  const dv = v(x.dateVersement) ? fd(v(x.dateVersement)) : '[à compléter]';
  const dr = v(x.dateRevision) ? fd(v(x.dateRevision)) : '[à compléter]';
  return 'Le précédent locataire a quitté le logement moins de dix-huit mois avant la signature du présent bail (mention obligatoire — ' + note + '). '
    + 'Montant du dernier loyer acquitté par le précédent locataire : ' + montant
    + ' ; date de versement : ' + dv
    + ' ; date de la dernière révision du loyer : ' + dr + '.';
}

// ── IV.G (nu) / IV.F (meublé) — Dépenses énergétiques (pour information) ───────────────────────

/**
 * [VERBATIM] du modèle, les deux […] remplis. Valeur absente → renvoi au DPE annexé (jamais un
 * montant ou une année inventés).
 */
export function texteDepensesEnergie(montant, annee) {
  const m = String(montant == null ? '' : montant).trim() || 'voir le diagnostic de performance énergétique annexé';
  const a = String(annee == null ? '' : annee).trim() || 'voir le diagnostic de performance énergétique annexé';
  return 'Montant estimé des dépenses annuelles d\'énergie pour un usage standard de l\'ensemble des usages énumérés dans le diagnostic de performance énergétique (chauffage, refroidissement, production d\'eau chaude sanitaire, éclairage et auxiliaires de chauffage, de refroidissement, d\'eau chaude sanitaire et de ventilation) mentionné à l\'article L. 126-26 du code de la construction et de l\'habitation : '
    + m + ' (estimation réalisée à partir des prix énergétiques de référence de l\'année : ' + a + ').';
}

// ── VIII — Clause résolutoire ─────────────────────────────────────────────────────────────────

/** [VERBATIM] Le texte que le modèle IMPOSE (décret n° 2026-596). */
export const CLAUSE_RESOLUTOIRE_TEXTE = 'Le contrat de location est résilié de plein droit pour défaut de paiement du loyer ou des charges aux termes convenus ou pour non versement du dépôt de garantie. La clause de résiliation de plein droit ne produit effet que six semaines après la date d\'un commandement de payer demeuré infructueux.';

/**
 * [RÉDACTION D'APRÈS LE MODÈLE] Les AUTRES motifs de résiliation de plein droit. Consigne source
 * (VIII, verbatim) : « [clause prévoyant la résiliation de plein droit du contrat de location pour
 * la non-souscription d'une assurance des risques locatifs qui ne produit effet qu'un mois après
 * commandement demeuré infructueux, le non-respect de l'obligation d'user paisiblement des locaux
 * loués, résultant de troubles de voisinage constatés par une décision de justice passée en force
 * de chose jugée ou, lorsque le logement est soumis à l'obligation prévue à l'article L. 151-14-1
 * du code de l'urbanisme, pour le non-respect de l'obligation de l'occuper exclusivement à titre de
 * résidence principale. Dans ce dernier cas, la clause ne peut produire effet qu'à l'expiration
 * d'un délai de mise en demeure fixé par le maire conformément au II de l'article L. 481-4 du code
 * de l'urbanisme.] ». Chaque motif reprend ces mots ; seul ajout : le renvoi à l'article 7 de la
 * loi du 6 juillet 1989 (déjà présent dans la clause d'origine de l'app).
 * @param {boolean} servitude logement soumis à l'art. L. 151-14-1 du code de l'urbanisme
 * @returns {string[]}
 */
export function autresMotifsResolutoires(servitude) {
  const out = [
    'Non-souscription d\'une assurance des risques locatifs : la clause ne produit effet qu\'un mois après commandement demeuré infructueux (article 7 de la loi du 6 juillet 1989) ;',
    'Non-respect de l\'obligation d\'user paisiblement des locaux loués, résultant de troubles de voisinage constatés par une décision de justice passée en force de chose jugée' + (servitude ? ' ;' : '.')
  ];
  if (servitude) {
    out.push('Le logement étant soumis à l\'obligation prévue à l\'article L. 151-14-1 du code de l\'urbanisme, non-respect de l\'obligation de l\'occuper exclusivement à titre de résidence principale. Dans ce dernier cas, la clause ne peut produire effet qu\'à l\'expiration d\'un délai de mise en demeure fixé par le maire conformément au II de l\'article L. 481-4 du code de l\'urbanisme.');
  }
  return out;
}

// ── XI — Annexes ──────────────────────────────────────────────────────────────────────────────

/** [D'APRÈS LE MODÈLE] « D. Un état des lieux (21) » (nu) / « D. Un état des lieux, un inventaire et un état détaillé du mobilier (42) » (meublé). */
export function libelleAnnexeEtatDesLieux(meuble) {
  return meuble ? 'État des lieux, inventaire et état détaillé du mobilier' : 'État des lieux d\'entrée';
}
/** [D'APRÈS LE MODÈLE] « E. Le cas échéant, Une autorisation préalable de mise en location » : jamais « N/A » affirmé. */
export const STATUT_AUTORISATION_PREALABLE = 'Le cas échéant';

// ── Avertissement AU BAILLEUR avant signature ─────────────────────────────────────────────────

/** Les marqueurs qu'un bail peut imprimer quand une donnée manque (jamais une valeur inventée). */
export const MARQUEURS_A_COMPLETER = ['[à compléter]', '[JJ/MM/AAAA]', 'à préciser]', 'À compléter par avenant'];

/**
 * Les mentions encore « à compléter » d'un bail rendu (structure de blocs de buildBailStructure) :
 * une entrée par endroit, rattachée à sa section (dernier titre `h2`). Sert UNIQUEMENT à avertir
 * le bailleur avant qu'il lance la signature — jamais affiché au locataire, jamais bloquant.
 * @param {Array<{type:string,text?:string,items?:string[],rows?:string[][],segments?:{text:string}[]}>} blocks
 * @returns {{section:string, mention:string}[]}
 */
export function mentionsACompleter(blocks) {
  const out = [];
  const vus = new Set();
  let section = '';
  const aMarqueur = t => MARQUEURS_A_COMPLETER.some(m => String(t).includes(m));
  // Le libellé de la mention : ce qui précède le marqueur, depuis la dernière ponctuation forte.
  const libelle = t => {
    const s = String(t);
    const i = Math.min(...MARQUEURS_A_COMPLETER.map(m => { const k = s.indexOf(m); return k === -1 ? Infinity : k; }));
    const avant = s.slice(0, i).replace(/[\s:–—-]+$/, '');
    const coupe = Math.max(avant.lastIndexOf('. '), avant.lastIndexOf(' ; '), avant.lastIndexOf(' / '));
    const lib = (coupe === -1 ? avant : avant.slice(coupe + 2)).replace(/^[\s;/]+/, '').replace(/[\s[(—–-]+$/, '').trim() || s.slice(0, 60);
    return lib.length > 70 ? '…' + lib.slice(-69).replace(/^\S*\s/, '') : lib;
  };
  const noter = (mention) => {
    const cle = section + '|' + mention;
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push({ section, mention });
  };
  for (const b of (blocks || [])) {
    if (!b) continue;
    if (b.type === 'h2') { section = String(b.text || ''); continue; }
    if (b.type === 'table' && Array.isArray(b.rows)) {
      for (const r of b.rows) {
        if (Array.isArray(r) && r.slice(1).some(aMarqueur)) noter(String(r[0]));
      }
      continue;
    }
    const textes = [];
    if (b.text) textes.push(b.text);
    if (Array.isArray(b.items)) textes.push(...b.items);
    if (Array.isArray(b.segments)) textes.push(b.segments.map(s => s && s.text || '').join(''));
    for (const t of textes) {
      // Une phrase peut porter plusieurs manques (« … : [à compléter] ; date … : [à compléter] »).
      String(t).split(/ ; | \/ (?=[A-ZÉÈÀ])|\. (?=[A-ZÉÈÀ])/).forEach(part => { if (aMarqueur(part)) noter(libelle(part)); });
    }
  }
  return out;
}
