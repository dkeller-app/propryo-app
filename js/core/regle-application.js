/**
 * js/core/regle-application.js — marqueur « classé à la main » d'un mouvement (RETOURS 15/10, lot 2, point 5).
 *
 * Décision de Didier du 16/10 : « pour les mouvements une règle n'affecte pas le passé que le futur. Comme ça on
 * considère que l'utilisateur a bien fait jusqu'à présent et on évite les erreurs. » Une règle ne s'applique donc qu'aux
 * prochains imports (et à l'import en cours) ; la proposition d'application aux mouvements déjà enregistrés (v15.746) est
 * retirée. Seul reste ici ce qui sert au mouvement de départ d'une règle :
 *
 * `m._classeMain` — posé quand la fiche d'un mouvement change sa catégorie ou son affectation (et par l'import pour une
 * ligne retouchée). Quand l'utilisateur MODIFIE une règle depuis la fiche d'un mouvement classé à la main, l'app demande
 * avant de le reclasser (jamais un choix manuel remplacé sans le dire).
 */

const CHAMPS = ['cat', 'qui', 'imm', 'compteurCcId']
const s = v => (v == null ? '' : String(v))

/** Le classement d'un mouvement (catégorie + affectation), en chaînes. */
export function classementDe(m) {
  const o = {}
  for (const k of CHAMPS) o[k] = s(m && m[k])
  return o
}

export function memeClassement(a, b) {
  return CHAMPS.every(k => s(a && a[k]) === s(b && b[k]))
}

/**
 * La fiche d'un mouvement a-t-elle changé son classement à la main ? (catégorie ou affectation différente)
 * Rend true si oui ; sinon false (le marqueur existant est alors conservé tel quel par l'appelant).
 */
export function classeMainApresEdition(avant, apres) {
  return !memeClassement(classementDe(avant), classementDe(apres))
}
