/**
 * core/irl-garde-fou.js — LES GARDE-FOUS DE LA RÉVISION IRL, NON BLOQUANTS (V20/V21).
 *
 * Arbitrage Didier du 19/08, mot pour mot :
 *   « L'app doit prévenir mais pas bloquer tout le temps l'utilisateur. S'il ne veut pas
 *     remplir les DPE, il doit quand même pouvoir utiliser les fonctionnalités. On garde des
 *     garde-fous partout mais pas bloquants. »
 *
 * Le geste est donc TOUJOURS offert quand c'est une RÈGLE qui l'empêchait — la fenêtre cite
 * la règle, dit ce que ça engage, demande une confirmation à cocher, et laisse passer.
 *
 * Il ne l'est PAS quand il n'y a rien à calculer ni rien à réviser encore : « bail de moins
 * d'un an » et « indice non publié » ne sont pas des verrous, c'est le vide — la date n'est
 * pas arrivée, ou l'INSEE n'a rien publié. Un bouton « quand même » y serait un mensonge.
 * C'est l'exception assumée du CDC (V21).
 *
 * Pur / testable : aucune lecture de DB, aucun DOM.
 * Tests : __tests__/helpers/irl-garde-fou.test.js
 */

export const GARDE = Object.freeze({
  GEL: 'gel',                    // DPE F ou G — loi Climat & Résilience, art. 23
  DPE_ABSENT: 'dpe-absent',      // aucun DPE saisi : l'app ne PEUT PAS vérifier le gel
  CYCLE_ETEINT: 'cycle-eteint',  // cycle non appliqué, éteint par le délai d'un an (art. 17-1)
  MOINS_UN_AN: 'moins-un-an',    // IRL-REVISION R12 : date commune < 1 an après le début du bail
  TROP_JEUNE: 'trop-jeune',      // pas un verrou : la date n'est pas arrivée
  INDICE: 'indice-manquant',     // pas un verrou : l'INSEE n'a rien publié
  RIEN_A_REVISER: 'rien-a-reviser' // règle ANIL : l'indice connu à la date de révision est déjà appliqué
});

// Audit M4 — un seul avertissement s'affiche (le plus fort) : s'il n'est pas « bail < 1 an », il le
// mentionne quand même, sinon le mode forcé l'escamote.
const _moinsUnAn = (r) => (r && r.moinsDunAn)
  ? ' <b>Par ailleurs</b>, cette date de révision tombe moins d’un an après le début du bail : une première augmentation aussi précoce peut être contestée par le locataire.'
  : '';

const _fr = (iso) => {
  const s = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s;
};

/**
 * LE garde-fou d'un lot, d'après l'état de sa révision.
 *
 * ⚠️ `ctx.surCyclePerdu` (audit 19/08, défaut C2) — le cycle éteint n'est PAS un état du lot,
 * c'est un GESTE : « appliquer quand même le cycle du JJ/MM ». `etatRevision` attache `perdue`
 * aussi bien à un lot `en-retard` qu'à un lot `a-preparer` (cas très courant : le cycle N-1 n'a
 * jamais été appliqué, le cycle N est ouvert et parfaitement révisable). Déclencher la branche
 * `perdue` sur la seule présence du champ murait donc la révision ORDINAIRE — exactement ce que
 * le §0 du CDC interdit — et proposait en plus le loyer du mauvais cycle. La branche ne s'ouvre
 * désormais que sur demande explicite, depuis la pastille « IRL non appliquées ».
 *
 * @param {Object} rev sortie de computeIRLRevision : { gelDpeFG, dpe, dpeManquant, etat,
 *        effetPrevuIso, missingKey, perdue:{effetIso, annee}, premiereAnniv }
 * @param {{gainMensuel?:number|null, typeLot?:string, fmtMontant?:Function,
 *          surCyclePerdu?:boolean}} [ctx]
 * @returns {{kind:string, peut:boolean, ico?:string, titre?:string, loi?:string,
 *            consequence?:string, confirmation?:string, cta?:string, pourquoi?:string}|null}
 *          null = aucun garde-fou, la révision est ordinaire.
 */
export function gardeFouRevision(rev, ctx) {
  const r = rev || {};
  const c = ctx || {};
  const eur = (n) => (typeof c.fmtMontant === 'function')
    ? c.fmtMontant(n) : (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €';

  // ── V20 — cycle éteint : les mois passés ne se rattrapent plus, mais l'avenir, si.
  // UNIQUEMENT sur le geste explicite : sinon un lot dont un vieux cycle dort verrait sa
  // révision courante bloquée par un avertissement qui ne la concerne pas.
  if (c.surCyclePerdu && r.perdue && r.perdue.effetIso) {
    const prescritIso = (parseInt(String(r.perdue.effetIso).slice(0, 4), 10) + 1) + String(r.perdue.effetIso).slice(4);
    const gain = (c.gainMensuel != null) ? c.gainMensuel : null;
    return {
      kind: GARDE.CYCLE_ETEINT, peut: true, ico: '⏸',
      titre: 'Appliquer une révision dont le cycle est éteint',
      loi: `Le cycle du ${_fr(r.perdue.effetIso)} est éteint depuis le ${_fr(prescritIso)} `
        + '(délai d’un an, art. 17-1 de la loi du 6 juillet 1989).',
      consequence: '<b>Les mois passés ne sont plus réclamables</b> : le manque à gagner'
        + (gain != null ? ` (≈ ${eur(gain)}/mois depuis le ${_fr(r.perdue.effetIso)})` : '')
        + ' ne se rattrape pas. Appliquée aujourd’hui, l’augmentation vaut <b>pour l’avenir</b> — '
        + 'et le locataire peut la contester en s’appuyant sur la prescription.',
      confirmation: 'J’ai compris que les mois passés sont perdus et que le locataire peut contester',
      cta: 'Appliquer quand même'
    };
  }

  // ── V20 — gel légal DPE F/G.
  if (r.gelDpeFG) {
    const cl = String(r.dpe || '').toUpperCase() === 'G' ? 'G' : 'F';
    return {
      kind: GARDE.GEL, peut: true, ico: '🔒',
      titre: 'Réviser un logement dont le loyer est gelé',
      loi: `Ce logement est classé ${cl}. La loi Climat &amp; Résilience (art. 23) `
        + '<b>interdit l’augmentation du loyer</b> des logements F et G.',
      consequence: 'Une révision appliquée <b>n’est pas opposable au locataire</b> : il peut refuser '
        + 'de payer l’augmentation et réclamer le remboursement de ce qu’il aurait versé en trop. '
        + 'La lettre part quand même sur décision du bailleur.' + _moinsUnAn(r),
      confirmation: 'J’ai compris que cette révision n’est pas opposable au locataire',
      cta: 'Réviser quand même'
    };
  }

  // ── V21 — le blocage « DPE absent » est LEVÉ.
  if (r.dpeManquant) {
    return {
      kind: GARDE.DPE_ABSENT, peut: true, ico: '📄',
      titre: 'Réviser sans DPE renseigné',
      loi: 'Aucun DPE n’est saisi pour ce lot : l’app <b>ne peut pas vérifier</b> si le gel des '
        + 'logements F et G s’applique.',
      consequence: 'Rien n’empêche de réviser. Mais si le logement s’avère classé F ou G, '
        + 'l’augmentation ne sera pas opposable au locataire. '
        + '<b>Un garage, une cave ou un parking n’a pas de DPE par nature</b> — le gel ne les vise pas, '
        + 'aucune vérification n’est attendue.' + _moinsUnAn(r),
      confirmation: 'J’ai compris que l’app ne peut pas vérifier le gel F/G sur ce lot',
      cta: 'Réviser quand même'
    };
  }

  // ── IRL-REVISION R12 — date de révision CONVENUE tombant moins d'un an après le début du bail
  // (date commune du bailleur). Le bail est signé : jamais bloquant, mais on prévient.
  if (r.moinsDunAn && (r.etat === 'a-preparer' || r.etat === 'en-retard')) {
    return {
      kind: GARDE.MOINS_UN_AN, peut: true, ico: '📅',
      titre: 'Réviser un bail de moins d’un an',
      loi: 'La date de révision convenue au bail'
        + (r.effetPrevuIso ? ` (${_fr(r.effetPrevuIso)})` : '')
        + ' tombe moins d’un an après son début'
        + (r.debutBail ? ` (${_fr(r.debutBail)})` : '')
        + '. L’article 17-1 de la loi du 6 juillet 1989 prévoit une révision « chaque année à la date convenue entre les parties ».',
      consequence: 'La révision reste possible : la date figure au bail signé. <b>À vérifier avant d’envoyer la lettre</b> : '
        + 'une première augmentation moins d’un an après l’entrée dans les lieux peut être contestée par le locataire.',
      confirmation: 'J’ai vérifié que cette date de révision figure au bail et je valide cette première révision',
      cta: 'Réviser quand même'
    };
  }

  // ── V21, exception assumée SANS bouton : il n'y a rien à débloquer.
  if (r.etat === 'trop-jeune') {
    const quand = r.effetPrevuIso ? _fr(r.effetPrevuIso)
      : (r.premiereAnniv && r.premiereAnniv.toLocaleDateString ? r.premiereAnniv.toLocaleDateString('fr-FR') : '');
    return {
      kind: GARDE.TROP_JEUNE, peut: false,
      pourquoi: 'La première révision arrive au <b>premier anniversaire du bail</b>'
        + (quand ? ` (${quand})` : '') + '. Il n’y a rien à réviser avant : ce n’est pas un verrou, '
        + 'c’est la date qui n’est pas encore là.'
    };
  }
  // Décision 25/09 (règle ANIL) — l'indice connu à la date de révision est déjà dans le loyer.
  if (r.etat === 'rien-a-reviser') {
    return {
      kind: GARDE.RIEN_A_REVISER, peut: false,
      pourquoi: 'L’indice à retenir est celui <b>connu à la date de révision</b>'
        + (r.effetPrevuIso ? ` (${_fr(r.effetPrevuIso)})` : '')
        + (r.T && r.N ? `, soit l’IRL T${r.T} ${r.N}` : '')
        + ' : il est <b>déjà appliqué</b> au loyer (révision précédente). L’appliquer à nouveau augmenterait deux fois le loyer pour la même variation. '
        + 'Rien à réviser cette année — la prochaine révision suit le calendrier normal.'
    };
  }
  if (r.etat === 'indice-manquant') {
    return {
      kind: GARDE.INDICE, peut: false,
      pourquoi: 'L’indice de référence' + (r.missingKey ? ` (${r.missingKey})` : '')
        + ' n’est <b>pas encore publié</b> par l’INSEE. Le calcul est impossible tant qu’il manque — '
        + 'rien à débloquer : la révision apparaîtra dès la publication.'
    };
  }
  return null;
}

/**
 * Le geste est-il offert ? Réponse binaire, pour l'affichage d'un bouton.
 * @returns {boolean}
 */
export function revisionForcable(rev, ctx) {
  const g = gardeFouRevision(rev, ctx);
  return !!(g && g.peut);
}

/**
 * Le libellé du bouton quand il existe — jamais un mot inventé côté écran.
 * @returns {string|null}
 */
export function libelleForcage(rev, ctx) {
  const g = gardeFouRevision(rev, ctx);
  return (g && g.peut) ? g.cta : null;
}
