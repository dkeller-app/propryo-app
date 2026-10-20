/**
 * bail-duree.js — QUI est le bailleur, et donc quelle durée minimale s'impose au bail nu.
 *
 * L'app classait l'entité par `/personne physique|perso/i` sur un champ de saisie LIBRE
 * (placeholder « SCI IS, SCI IR, Personne physique… »). Le motif `perso` est contenu dans
 * « PERSOnne morale » : une entité typée « Personne morale » était donc lue comme une personne
 * physique (bail de 3 ans, mention « le bailleur étant une personne physique »), et un bailleur
 * qui tapait « Particulier » obtenait l'inverse — un bail de 6 ans se déclarant SCI. Dans le PDF
 * SIGNÉ. Un engagement contractuel du double de la durée due, et une tacite reconduction
 * « pour une durée égale à celle du bail initial » qui reconduit l'erreur.
 *
 * LE DROIT (vérifié sur Légifrance, art. 10 et art. 13 de la loi n° 89-462 du 6 juillet 1989) :
 * la durée est « au moins égale à trois ans pour les bailleurs personnes physiques AINSI QUE
 * POUR LES BAILLEURS DÉFINIS À L'ARTICLE 13 et à six ans pour les bailleurs personnes morales ».
 * L'article 13 vise la société civile « constituée exclusivement entre parents et alliés jusqu'au
 * quatrième degré inclus » (SCI familiale) et le logement détenu en indivision.
 *
 * L'app le savait déjà, mais seulement dans la NOTICE annexée au bail, qui dit « trois ans
 * lorsque le bailleur est une personne physique ou une société civile immobilière familiale ».
 * Un bail de SCI familiale se contredisait donc lui-même : six ans dans son corps, trois dans
 * son annexe.
 *
 * ⚠️ CE MODULE NE DEVINE PAS. Une « SCI » sans mention de son caractère familial est
 * indéterminable : le modèle de données ne porte aucun attribut pour ça (`sci_familiale` n'existe
 * que comme profil d'INTERFACE). Dans ce cas on retient six ans — le régime de droit commun des
 * personnes morales — mais la phrase du contrat cesse d'affirmer une qualification qu'on n'a pas
 * établie, et `certain` vaut false pour que l'appelant puisse le signaler.
 */

/** Minuscules, sans accents, espaces normalisées : un champ libre se compare normalisé. */
function _norm(x) {
  return String(x == null ? '' : x)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Une société civile (SCI…) : personne morale certaine, même quand son caractère familial ne l'est pas. */
const _RE_SOCIETE_CIVILE = /\bsci\b|societe civile/;

/**
 * Classe le bailleur au regard de l'art. 10.
 * @param {string} typeEntite le champ libre « type » de l'entité
 * @returns {{regime:'physique'|'art13'|'morale', ans:3|6, certain:boolean, motif:string}}
 */
export function regimeBailleur(typeEntite) {
  const t = _norm(typeEntite);
  if (!t) return { regime: 'morale', ans: 6, certain: false, motif: 'type de bailleur non renseigné' };

  // ORDRE VOLONTAIRE : « personne morale » d'abord, sinon le fragment « perso » qu'il contient
  // le ferait basculer du côté des personnes physiques — c'est exactement le défaut d'origine.
  if (/personne morale|societe anonyme|\bsarl\b|\bsas\b|\bsa\b|association|organisme|\bhlm\b/.test(t)) {
    // …sauf si cette personne morale est précisément une de celles de l'art. 13.
    if (/familial/.test(t)) return { regime: 'art13', ans: 3, certain: true, motif: 'société civile familiale (art. 13)' };
    return { regime: 'morale', ans: 6, certain: true, motif: 'personne morale (art. 10)' };
  }
  if (/indivision/.test(t)) return { regime: 'art13', ans: 3, certain: true, motif: 'logement en indivision (art. 13)' };
  if (/personne physique|particulier|\bphysique\b|proprietaire individuel|nom propre/.test(t)) {
    return { regime: 'physique', ans: 3, certain: true, motif: 'personne physique (art. 10)' };
  }
  if (_RE_SOCIETE_CIVILE.test(t)) {
    if (/familial/.test(t)) return { regime: 'art13', ans: 3, certain: true, motif: 'SCI familiale (art. 13)' };
    // Indéterminable : une SCI est à 6 ans, SAUF si elle est familiale — et rien ne le dit ici.
    return { regime: 'morale', ans: 6, certain: false, motif: 'SCI dont le caractère familial n\'est pas renseigné' };
  }
  return { regime: 'morale', ans: 6, certain: false, motif: 'type de bailleur non reconnu' };
}

/** Le libellé de durée du bail nu : « 3 (trois) ans » / « 6 (six) ans ». */
export function dureeBailNuLabel(typeEntite) {
  return regimeBailleur(typeEntite).ans === 3 ? '3 (trois) ans' : '6 (six) ans';
}

/**
 * La phrase du contrat qui justifie la durée. Elle n'affirme la qualité du bailleur que si
 * celle-ci a été ÉTABLIE ; sinon elle énonce la durée retenue et la règle, sans certifier.
 */
export function dureeBailNuPhrase(typeEntite) {
  const r = regimeBailleur(typeEntite);
  const loi = 'l’article 10 de la loi du 6 juillet 1989';
  if (!r.certain) {
    return 'Cette durée de ' + r.ans + ' ans est retenue en application de ' + loi
      + ', qui fixe la durée minimale à trois ans pour les bailleurs personnes physiques et ceux définis à l’article 13 (société civile familiale, indivision), et à six ans pour les autres personnes morales.';
  }
  if (r.regime === 'physique') {
    return 'Cette durée de 3 ans s’applique conformément à ' + loi + ', le bailleur étant une personne physique.';
  }
  if (r.regime === 'art13') {
    return 'Cette durée de 3 ans s’applique conformément à ' + loi + ' et à l’article 13 de la même loi, le bailleur relevant des sociétés civiles constituées exclusivement entre parents et alliés jusqu’au quatrième degré ou de l’indivision.';
  }
  return 'Cette durée de 6 ans s’applique conformément à ' + loi + ', le bailleur étant une personne morale.';
}

/** Le sous-titre imprimé par les baux nus de version de clauses ≤ 3, quel que soit le bailleur. */
export const SOUS_TITRE_BAIL_NU_ORIGINE = 'Loi n° 89-462 du 6 juillet 1989 — Art. 10 — Bailleur personne morale';

/**
 * Le sous-titre du bail nu (sous « BAIL DE LOCATION DE LOGEMENT NU »).
 * Il a longtemps dit « Bailleur personne morale » pour TOUT bailleur, personne physique comprise.
 * Un bail signé se ré-affiche tel qu'il a été signé : en version de clauses ≤ 3 (marqueur
 * `clauseIrlV` gravé à la signature, cf. contrat-type.js), le texte d'origine, mot pour mot.
 * @param {string} typeEntite le champ libre « type » de l'entité
 * @param {number} versionClauses la version des clauses du bail (_bailClauseVersion)
 */
export function sousTitreBailNu(typeEntite, versionClauses) {
  if (!(Number(versionClauses) >= 4)) return SOUS_TITRE_BAIL_NU_ORIGINE;
  const r = regimeBailleur(typeEntite);
  const loi = 'Loi n° 89-462 du 6 juillet 1989';
  if (r.regime === 'physique') return loi + ' — Art. 10 — Bailleur personne physique';
  if (r.regime === 'art13') return loi + ' — Art. 10 et 13 — Bailleur relevant de l’article 13';
  // Type vide ou non reconnu : six ans retenus, mais la qualité du bailleur n'est pas établie —
  // on ne la certifie pas (même règle que dureeBailNuPhrase). Une SCI, elle, est une personne
  // morale de toute façon : seul son caractère familial est incertain.
  if (!r.certain && !_RE_SOCIETE_CIVILE.test(_norm(typeEntite))) return loi + ' — Art. 10';
  return SOUS_TITRE_BAIL_NU_ORIGINE;
}
