/**
 * actes-mentions.js — Un acte juridique ne sort pas de l'app avec ses trous.
 *
 * Les générateurs d'actes (congé, mise en demeure, avenant) remplacent un champ vide par un
 * marqueur LISIBLE entre guillemets simples — « ‹prix› », « ‹à compléter› » — plutôt que par
 * un blanc qui passerait pour du texte final. C'est le bon choix à l'écran. Mais rien
 * n'empêchait le document de partir en PDF avec ces marqueurs dedans.
 *
 * Pour certaines mentions, ce n'est pas un défaut de présentation : c'est la NULLITÉ de l'acte.
 * L'article 15-II de la loi du 6 juillet 1989 impose le prix et les conditions de la vente dans
 * un congé pour vente, et l'article 15-I impose le motif et, en cas de reprise, le bénéficiaire.
 * Un congé portant « ‹prix› » ne vaut rien — et le bailleur ne s'en aperçoit qu'au tribunal.
 *
 * Ce module ne bloque pas : il NOMME ce qui manque et dit ce que ça coûte. La décision reste à
 * l'utilisateur, comme pour l'avenant (`avenantChampsManquants`) — l'app alerte, elle n'interdit
 * pas. Mais elle ne laisse plus passer en silence.
 *
 * ⚠️ CE QUI PROTÈGE CETTE DÉTECTION, ce n'est pas la rareté du caractère : `›` est au contraire
 * très répandu dans l'INTERFACE (chevrons de fil d'Ariane, « Continuer › », `content:'›'` en CSS).
 * C'est qu'on exige une PAIRE `‹…›`, et qu'aucun chevron de l'interface n'atteint le DOCUMENT :
 * `_docPage` et `letterToProDoc` n'en produisent aucun. Quiconque ajouterait un chevron dans le
 * gabarit de document casserait donc un garde-fou légal sans s'en apercevoir. Si cela arrive,
 * changer de marqueur — jamais assouplir cette détection.
 */

/** Un marqueur = un chevron simple ouvrant, du texte sans chevron, un chevron fermant. */
const RE_MARQUEUR = /‹([^›]{1,150})›/g;

/**
 * Les mentions dont l'absence est sanctionnée par la NULLITÉ de l'acte, et leur fondement.
 * Clé = le texte exact du marqueur posé par le générateur (index.html, `_congeExtra`).
 * Le fondement est repris des mentions que l'app affiche déjà dans le corps du congé.
 */
const NULLITE = {
  'prix': 'art. 15-II de la loi du 6 juillet 1989 : le prix de la vente doit figurer dans le congé, à peine de nullité',
  'conditions': 'art. 15-II de la loi du 6 juillet 1989 : les conditions de la vente doivent figurer dans le congé, à peine de nullité',
  'bénéficiaire': 'art. 15-I de la loi du 6 juillet 1989 : le congé pour reprise doit indiquer les nom et adresse du bénéficiaire ainsi que la nature du lien avec le bailleur, à peine de nullité',
  'adresse du bénéficiaire': 'art. 15-I de la loi du 6 juillet 1989 : le congé pour reprise doit indiquer les nom et ADRESSE du bénéficiaire, à peine de nullité',
  'nature du lien avec le bailleur': 'art. 15-I de la loi du 6 juillet 1989 : le congé pour reprise doit indiquer la nature du lien entre le bailleur et le bénéficiaire, à peine de nullité',
  'description du motif légitime et sérieux': 'art. 15-I de la loi du 6 juillet 1989 : le motif du congé doit être énoncé, à peine de nullité'
};

/**
 * BAUX-ECHUS — un congé de bail MEUBLÉ repose sur l'art. 25-8, I, qui impose dans les mêmes termes que
 * l'art. 15-I « le motif allégué et, en cas de reprise, les nom et adresse du bénéficiaire de la
 * reprise ainsi que la nature du lien » à peine de nullité. La lettre meublé (« bail-conge-bailleur-meuble »)
 * cite l'art. 25-8, I : on le reconnaît dans le DOCUMENT rendu, comme les marqueurs eux-mêmes.
 */
const RE_CONGE_MEUBLE = /article 25-8, I\b/;
function _fondementMeuble(fondement) {
  return fondement.replace('art. 15-I de la loi du 6 juillet 1989', 'art. 25-8, I de la loi du 6 juillet 1989');
}

/** Libellés lisibles pour les marqueurs qui n'emportent pas nullité. */
const LIBELLES = {
  'à compléter': 'un champ de l’avenant',
  'montant': 'le montant dû',
  // Trous d'identité du signataire d'un acte formel (`_enrichContextActe`, email-compose.js).
  // Aucun texte n'impose le lieu de rédaction : ils alertent, ils n'emportent pas nullité.
  'lieu de rédaction': 'le lieu de rédaction de l’acte (siège de l’entité)',
  'signataire': 'le signataire de l’acte (gérant de l’entité)',
  'période': 'la période concernée',
  'début du bail': 'la date de début du bail',
  'échéance du bail': 'l’échéance du bail'
};

/**
 * Les mentions encore vides dans un acte RENDU (on lit le document produit, pas le formulaire :
 * c'est ce qui part au locataire qui fait foi, et ça couvre tous les générateurs d'un coup).
 *
 * @param {string} html le document tel qu'il sera imprimé
 * @returns {Array<{marqueur:string, libelle:string, nullite:boolean, fondement:string}>}
 *          dans l'ordre d'apparition, sans doublon
 */
export function mentionsManquantes(html) {
  const src = (html == null) ? '' : String(html);
  const vues = new Set();
  const out = [];
  const meuble = RE_CONGE_MEUBLE.test(src);
  let m;
  RE_MARQUEUR.lastIndex = 0;   // regex globale partagée : sans ça, un appel sur deux repart du milieu
  while ((m = RE_MARQUEUR.exec(src)) !== null) {
    const marqueur = m[1];
    if (vues.has(marqueur)) continue;
    vues.add(marqueur);
    const fondement = meuble ? _fondementMeuble(NULLITE[marqueur] || '') : (NULLITE[marqueur] || '');
    out.push({
      marqueur,
      libelle: LIBELLES[marqueur] || marqueur,
      nullite: !!fondement,
      fondement
    });
  }
  return out;
}

/**
 * LA DÉCISION DE SORTIE, une fois pour toutes.
 *
 * Elle existait en double : la sortie PDF de la modale d'actes (`_acteMentionsOk`) et les
 * quatre sorties de la modale email (`_emActeMentionsOk`) prenaient la même décision avec
 * deux codes. Un garde-fou LÉGAL qu'on durcirait d'un côté seulement laisserait le même acte
 * sortir bloqué en PDF et libre en email — sans que rien ne le signale.
 *
 * ⚠ Ce garde-fou détecte des MARQUEURS, pas la complétude juridique : qui SUPPRIME la phrase
 * « au prix de ‹prix› € » au lieu de la compléter fait sortir l'acte sans alerte. C'est
 * assumé — l'app alerte sur ce qu'elle a généré, elle ne relit pas l'acte à la place du bailleur.
 *
 * @param {string} texte  l'acte TEL QU'IL VA SORTIR (document rendu, ou sujet + corps à l'écran)
 * @param {string} verbe  l'action demandée, pour la question finale
 * @param {function(string):boolean} demander  le dialogue (confirm2 / confirm)
 * @returns {boolean} false = renoncement : la sortie doit être interrompue
 */
export function sortieAutorisee(texte, verbe, demander) {
  const src = (texte == null) ? '' : String(texte);
  if (src.indexOf('\u2039') === -1) return true;      // aucun marqueur : rien à dire, aucun dialogue
  const manque = mentionsManquantes(src);
  if (!manque.length) return true;
  // Sans dialogue disponible, on REFUSE : un garde-fou légal ne s'évapore pas faute d'UI.
  if (typeof demander !== 'function') return false;
  return !!demander(messageMentionsManquantes(manque, verbe || 'Continuer'));
}

/** Vrai dès qu'une seule mention manquante emporte la nullité de l'acte. */
export function emporteNullite(mentions) {
  return (mentions || []).some((x) => x && x.nullite);
}

/**
 * Le texte du refus. Il doit répondre à trois questions, dans cet ordre : qu'est-ce qui manque,
 * qu'est-ce que ça coûte, et qu'est-ce que je fais. Un message qui dit seulement « champs vides »
 * pousse à cliquer « continuer » sans lire.
 *
 * @param {Array} mentions sortie de `mentionsManquantes`
 * @param {string} [verbe] l'action demandée, pour la question finale
 */
export function messageMentionsManquantes(mentions, verbe) {
  const list = (mentions || []).filter(Boolean);
  if (!list.length) return '';
  const graves = list.filter((x) => x.nullite);
  const autres = list.filter((x) => !x.nullite);
  const lignes = [];

  if (graves.length) {
    lignes.push(graves.length > 1
      ? 'Cet acte serait NUL : ' + graves.length + ' mentions obligatoires manquent.'
      : 'Cet acte serait NUL : une mention obligatoire manque.');
    lignes.push('');
    for (const g of graves) lignes.push('• ' + g.libelle + ' — ' + g.fondement);
  }
  if (autres.length) {
    if (graves.length) lignes.push('');
    lignes.push(graves.length
      ? 'Et le document affichera aussi, tel quel :'
      : 'Le document affichera, tel quel :');
    for (const a of autres) lignes.push('• ‹' + a.marqueur + '›');
  }
  lignes.push('');
  // « Inopposable » serait FAUX, et plus rassurant que la réalité : un acte inopposable vaut
  // entre les parties et ne peut qu'être invoqué contre un tiers, alors qu'un congé nul n'a
  // AUCUN effet — le bail se poursuit. On dit donc la conséquence, pas le terme de droit.
  // (Les quatre mentions fatales connues sont toutes des mentions de CONGÉ. Le jour où un autre
  //  acte en porte une, cette conséquence devra descendre dans la table `NULLITE`.)
  lignes.push(graves.length
    ? ((verbe || 'Continuer') + ' quand même ? Le congé serait sans effet : le bail se poursuivrait.')
    : ((verbe || 'Continuer') + ' quand même ?'));
  return lignes.join('\n');
}
