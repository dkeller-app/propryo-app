/**
 * core/dates-defaut.js — LES DATES PROPOSÉES PAR DÉFAUT DANS LES DOCUMENTS.
 *
 * CDC-LOYERS-DESIGN §4, surfaces 6, 7 et 8. Trois champs de date étaient pré-remplis
 * à `aujourd'hui` :
 *   · l'e-mail « reçu de dépôt de garantie » — « versé le … » ;
 *   · l'écran de restitution du DG — « date de versement prévue » ;
 *   · l'attestation de logement libéré — « en date du … ».
 * Un défaut à « aujourd'hui » n'est pas neutre : il est validé sans être lu, et le document
 * part avec une date fausse. Or ces trois dates existent déjà dans l'app — le mouvement
 * bancaire du DG, le mouvement de restitution, l'état des lieux de sortie.
 *
 * Règle (CDC-FINANCES §M-1 bis, « l'app ne devine rien ») : on propose la date RÉELLE
 * quand elle existe, et **rien** sinon. Jamais `aujourd'hui` en remplacement.
 *
 * Pur / testable : aucune lecture de DB, aucun DOM. Tout est injecté.
 * Tests : __tests__/helpers/dates-defaut.test.js
 */

const _iso = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10) : null);
const _vivant = (o) => !!o && !o._deleted;

/** Un libellé qui parle d'un dépôt de garantie (les catégories varient d'un espace à l'autre). */
const _RE_DG = /d[ée]p[ôo]t\s+de\s+garantie|\bD\.?G\.?\b|caution/i;

/**
 * Surface 6 — la date à laquelle le dépôt de garantie a été VERSÉ par le locataire.
 * On cherche un encaissement (crédit) rattaché au lot dont la catégorie ou le libellé
 * parle du DG. Le PLUS ANCIEN fait foi : c'est le versement d'entrée, pas un complément.
 * @param {Array} mouvements
 * @param {string} ref
 * @returns {string|null} 'YYYY-MM-DD' ou null — jamais « aujourd'hui »
 */
export function dateVersementDG(mouvements, ref) {
  const cands = (mouvements || [])
    .filter((m) => _vivant(m) && String(m.qui || '') === String(ref)
      && (Number(m.cr) || 0) > 0 && _iso(m.date)
      && (_RE_DG.test(String(m.cat || '')) || _RE_DG.test(String(m.lib || ''))))
    .map((m) => _iso(m.date))
    .sort();
  return cands.length ? cands[0] : null;
}

/**
 * Surface 7 — la date à laquelle le DG a été RESTITUÉ au locataire.
 * Un décaissement (débit) rattaché au lot qui parle du DG. Le PLUS RÉCENT fait foi.
 * Tant qu'il n'existe pas, l'écran ne propose rien : la restitution n'a pas eu lieu, et
 * pré-remplir « aujourd'hui » ferait signer une date qui n'est celle de rien.
 * @returns {string|null}
 */
export function dateRestitutionDG(mouvements, ref) {
  const cands = (mouvements || [])
    .filter((m) => _vivant(m) && String(m.qui || '') === String(ref)
      && (Number(m.db) || 0) > 0 && _iso(m.date)
      && (_RE_DG.test(String(m.cat || '')) || _RE_DG.test(String(m.lib || ''))))
    .map((m) => _iso(m.date))
    .sort();
  return cands.length ? cands[cands.length - 1] : null;
}

/**
 * Surface 8 — la date de l'état des lieux de SORTIE d'un lot.
 * @param {Array} edls DB.edl
 * @param {string} ref
 * @returns {string|null}
 */
export function dateEDLSortie(edls, ref) {
  const cands = (edls || [])
    .filter((e) => _vivant(e) && String(e.logement || '') === String(ref)
      && /sortie/i.test(String(e.type || '')) && _iso(e.date))
    .map((e) => _iso(e.date))
    .sort();
  return cands.length ? cands[cands.length - 1] : null;
}

/**
 * Surface 8 — la date de LIBÉRATION du logement (remise des clés).
 * Ordre de préférence, du plus factuel au moins factuel : la sortie déclarée au départ,
 * puis la fin effective du bail, puis l'EDL de sortie. Rien si aucune n'existe.
 * @param {{depart?:{dateSortie?:string}, finEffective?:string}} bail
 * @param {string|null} edlSortieIso
 */
export function dateLiberation(bail, edlSortieIso) {
  const b = bail || {};
  return _iso(b.depart && b.depart.dateSortie) || _iso(b.finEffective) || _iso(edlSortieIso) || null;
}
