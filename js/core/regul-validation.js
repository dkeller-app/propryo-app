/**
 * core/regul-validation.js — LA règle unique de la « régularisation de charges validée ».
 *
 * POURQUOI (ALERTE-REGUL, 14/10/2026) : l'alerte « Régularisation N-1 à émettre » ne s'effaçait jamais.
 *  1. Elle cherchait un mouvement de catégorie « régularisation » que le référentiel ne connaît pas
 *     (le solde d'une régul se range en « Charges récupérables »).
 *  2. La validation (« Valider la régul de l'immeuble », onglet Charges) vivait dans `DB.regulValidations`,
 *     une clé du blob de CONFIGURATION de l'espace propre (espace_config). Or la configuration n'est jamais
 *     partagée : un associé ne lit pas celle du propriétaire (store-multi.js : config de l'espace propre
 *     seulement) et n'écrit que la sienne. Une validation faite par un associé restait invisible des autres.
 *
 * DÉCISION (Didier, 14/10) : quand UN associé valide la régularisation d'un immeuble / d'un lot pour une
 * année, l'alerte disparaît pour TOUS les associés de la SCI. Validation PARTAGÉE, pas par utilisateur.
 *
 * STOCKAGE RETENU : sur le LOGEMENT lui-même, `logement.regulValidations = { 'AAAA-MM-JJ|AAAA-MM-JJ': {at} }`.
 * Le logement est une ligne de la table `logements`, rattachée à sa SCI (entite_id) et protégée par la RLS
 * par SCI existante (has_entite_access en lecture, has_entite_write en écriture) ; l'enregistrement complet
 * voyage dans `legacy_raw` et l'hydratation le reconstruit tel quel. Aucune migration de base, aucune
 * nouvelle surface RLS. Le logement couvre aussi, sans cas particulier, le « logement sans immeuble ».
 * Valider un immeuble = poser la validation sur chacun de ses logements affichés.
 *
 * Module PUR : pas de DB globale, pas de DOM. Les fonctions qui écrivent mutent les objets reçus (ceux de
 * DB) et laissent l'appelant persister ; `stamp` (le `_stamp` de l'app) est injecté.
 */

/** Libellé du groupe des logements sans immeuble dans l'onglet Charges (même texte que computeRegul). */
export const SANS_IMMEUBLE = '(sans immeuble)'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const vivant = (x) => !!x && typeof x === 'object' && !x._deleted

/** Groupe d'un logement dans l'onglet Charges : son immeuble, sinon « (sans immeuble) ». */
export function groupeRegul(logement) {
  return (logement && logement.imm) ? String(logement.imm) : SANS_IMMEUBLE
}

/** Clé d'une période de régularisation (dates ISO du/au). null si une date n'est pas ISO. */
export function clePeriode(du, au) {
  const d = String(du == null ? '' : du).slice(0, 10), a = String(au == null ? '' : au).slice(0, 10)
  if (!ISO.test(d) || !ISO.test(a)) return null
  return d + '|' + a
}

/** Lit une clé de période → {du, au}, ou null si elle n'est pas de la forme « AAAA-MM-JJ|AAAA-MM-JJ ». */
export function lirePeriode(cle) {
  const p = String(cle == null ? '' : cle).split('|')
  if (p.length !== 2 || !ISO.test(p[0]) || !ISO.test(p[1])) return null
  return { du: p[0], au: p[1] }
}

const validations = (logement) =>
  (logement && logement.regulValidations && typeof logement.regulValidations === 'object') ? logement.regulValidations : null

/** La régularisation de CETTE période exacte (écran Charges : du/au choisis) est-elle validée pour le logement ? */
export function periodeValidee(logement, du, au) {
  const v = validations(logement), k = clePeriode(du, au)
  return !!(v && k && v[k])
}

/**
 * La régularisation de l'année `annee` est-elle validée pour le logement ? (règle de l'ALERTE)
 * Compte toute période validée qui CONTIENT le 31/12 de l'année : l'exercice civil, ou un exercice décalé
 * qui se termine après (ex. 01/07/N-1 → 30/06/N). Une période partielle qui s'arrête avant le 31/12
 * (ex. janvier → mars) ne solde pas l'année.
 */
export function regulValideePourAnnee(logement, annee) {
  const v = validations(logement)
  const y = Number(annee)
  if (!v || !Number.isInteger(y)) return false
  const fin = String(y).padStart(4, '0') + '-12-31'
  return Object.keys(v).some((k) => {
    if (!v[k]) return false
    const p = lirePeriode(k)
    return !!p && p.du <= fin && p.au >= fin
  })
}

/**
 * Logements d'un groupe de l'onglet Charges : vivants, du groupe, et dans le filtre de bailleur actif
 * (`dansFiltre(l)`, optionnel) — y compris ceux sans occupation sur la période (sans effet sur l'alerte,
 * qui exige des loyers perçus). C'est sur eux que porte « Valider la régul ».
 */
export function logementsDuGroupe(logements, groupe, dansFiltre) {
  const f = typeof dansFiltre === 'function' ? dansFiltre : () => true
  return (Array.isArray(logements) ? logements : []).filter((l) => vivant(l) && groupeRegul(l) === groupe && f(l))
}

/**
 * Le groupe est-il validé pour la période ? Oui si TOUS les logements concernés le sont (et qu'il y en a).
 * `logements` = ceux qui ont une occupation sur la période (les lignes du décompte affiché) : un lot ajouté
 * plus tard à l'immeuble, sans occupation sur la période, ne remet pas l'immeuble « à valider ».
 */
export function groupeValide(logements, du, au) {
  const L = (Array.isArray(logements) ? logements : []).filter(vivant)
  return L.length > 0 && L.every((l) => periodeValidee(l, du, au))
}

/**
 * Pose la validation de la période sur chaque logement. Idempotent : une validation déjà posée garde sa
 * date d'origine (le premier associé qui a validé). `stamp(l)` est appelé sur chaque logement modifié.
 * @returns {{cle:string|null, refs:string[]}} refs des logements effectivement modifiés
 */
export function validerPeriode(logements, du, au, opts) {
  const o = opts || {}
  const k = clePeriode(du, au)
  const out = { cle: k, refs: [] }
  if (!k) return out
  const at = o.at || new Date().toISOString()
  for (const l of (Array.isArray(logements) ? logements : [])) {
    if (!vivant(l)) continue
    if (periodeValidee(l, du, au)) continue
    l.regulValidations = Object.assign({}, validations(l) || {}, { [k]: { at } })
    if (typeof o.stamp === 'function') o.stamp(l)
    out.refs.push(l.ref)
  }
  return out
}

/** Validations d'un logement → [{du, au, at}] (clés valides seulement), triées par début. */
export function validationsDuLogement(logement) {
  const v = validations(logement)
  if (!v) return []
  return Object.keys(v)
    .map((k) => ({ p: lirePeriode(k), val: v[k] }))
    .filter((x) => x.p && x.val)
    .map((x) => ({ du: x.p.du, au: x.p.au, at: (x.val && x.val.at) || null }))
    .sort((a, b) => (a.du < b.du ? -1 : a.du > b.du ? 1 : 0))
}

/**
 * Enregistrement de l'ESPACE PROPRE ? Même contrat que normalisation-loyers.js : `opts.espacePropre`
 * ABSENT = pas de filtre (hors cloud : tout est propre) ; présent = non tagué ou tagué de cet espace
 * (null = non tagué seulement, cas de l'associé invité sans espace à lui).
 */
export function estDeLEspacePropre(rec, opts) {
  const o = opts || {}
  if (!Object.prototype.hasOwnProperty.call(o, 'espacePropre')) return true
  const e = (rec && rec._espaceId != null) ? rec._espaceId : null
  return e == null || e === (o.espacePropre == null ? null : o.espacePropre)
}

/**
 * MIGRATION DOUCE EN DEUX TEMPS — ancien stockage `db.regulValidations` (config de l'espace propre, clés
 * « <immeuble>|<du>|<au> », « (sans immeuble) » compris) → validations portées par les logements.
 *  1er passage : la validation est COPIÉE sur les logements vivants de l'espace propre du groupe ; la clé
 *     héritée RESTE (si l'envoi d'un logement échoue — conflit, refus — le serveur gagne au rechargement et
 *     la copie serait perdue : la clé doit survivre pour être recopiée).
 *  Passage suivant : quand TOUS les logements cibles portent déjà la validation (donc relue du serveur au
 *     chargement), la clé est RETIRÉE ; l'objet vide est supprimé.
 * Une clé sans logement (immeuble disparu) ou illisible est CONSERVÉE telle quelle : rien n'est jeté.
 * `opts.espacePropre` : cf. estDeLEspacePropre.
 * @returns {{copiees:number, retirees:number, refs:string[], conservees:string[]}}
 */
export function migrerValidationsHeritees(db, opts) {
  const o = opts || {}
  const out = { copiees: 0, retirees: 0, refs: [], conservees: [] }
  if (!db || typeof db !== 'object') return out
  const ancien = db.regulValidations
  if (!ancien || typeof ancien !== 'object' || Array.isArray(ancien)) return out
  const propre = (l) => estDeLEspacePropre(l, o)
  const touches = new Set()
  for (const k of Object.keys(ancien)) {
    const val = ancien[k]
    const p = String(k).split('|')
    if (p.length < 3) { out.conservees.push(k); continue }
    const au = p.pop(), du = p.pop(), groupe = p.join('|')   // un « | » dans le nom de l'immeuble tient
    const cle = clePeriode(du, au)
    if (!cle || !val) { out.conservees.push(k); continue }
    const cibles = logementsDuGroupe(db.logements, groupe, propre)
    if (!cibles.length) { out.conservees.push(k); continue }
    const manquants = cibles.filter((l) => !(validations(l) || {})[cle])
    if (!manquants.length) { delete ancien[k]; out.retirees++; continue }   // déjà porté par tous : 2e temps
    for (const l of manquants) {
      l.regulValidations = Object.assign({}, validations(l) || {}, { [cle]: { at: (val && val.at) || null } })
      touches.add(l)
    }
    out.copiees++
  }
  if (!Object.keys(ancien).length) delete db.regulValidations
  for (const l of touches) { if (typeof o.stamp === 'function') o.stamp(l); out.refs.push(l.ref) }
  return out
}
