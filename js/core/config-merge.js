// js/core/config-merge.js — fusion à trois voies du blob de configuration d'un espace (`espace_config`,
// `espace_config_private`).
//
// Pourquoi : ces blobs étaient écrits en « dernier écrit gagne ». Un appareil resté ouvert sur une vieille
// copie réécrivait le blob ENTIER à son prochain enregistrement : une révision IRL, une période de barème,
// une règle d'import supprimée ailleurs revenait ; un ajout fait ailleurs disparaissait — sans signal.
// Désormais l'écriture est gardée par la version de la ligne ; sur conflit, on relit le serveur et on
// FUSIONNE ici ce que chaque côté a changé depuis la base commune.
//
// Règles (base = dernier état synchronisé connu de cet appareil, local = l'appareil, distant = serveur) :
//   • valeur inchangée d'un côté → on prend l'autre côté (y compris une suppression) ;
//   • objets simples modifiés des deux côtés → fusion récursive clé par clé ;
//   • tableaux modifiés des deux côtés → fusion élément par élément par IDENTITÉ (cleElementConfig) :
//     ajouté d'un côté = gardé, supprimé d'un côté sans modification de l'autre = supprimé ;
//   • même élément / même valeur modifié des deux côtés → le serveur gagne, conflit signalé ;
//     exception anti-résurrection : un élément marqué `_deleted` l'emporte toujours.
// Module PUR : aucune dépendance, aucun effet de bord.

const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Égalité profonde indépendante de l'ordre des clés (jsonb ne garde pas l'ordre d'insertion).
export function egalProfond (a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!egalProfond(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !egalProfond(a[k], b[k])) return false
  return true
}

const canon = v => {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (estObjet(v)) return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  return JSON.stringify(v === undefined ? null : v)
}

// Identité d'un élément de tableau de configuration. `chemin` = clés depuis la racine (ex. ['loyerBareme']).
// Un élément porteur d'un `id` est identifié par lui ; les tableaux métier sans id ont une clé composite
// stable ; à défaut, le contenu lui-même (un élément modifié = un retrait + un ajout).
export function cleElementConfig (chemin, el) {
  const racine = chemin && chemin[0]
  if (estObjet(el)) {
    if (el.id != null && el.id !== '') return 'id:' + String(el.id)
    if (racine === 'loyerBareme') return 'bareme:' + [el.ref, el.debut, el.source, el.bailDebut].map(x => x == null ? '' : String(x)).join('|')
    if (racine === 'irlHistorique') return 'irl:' + [el.ref, el.dateRevision, el.dateEffet].map(x => x == null ? '' : String(x)).join('|')
  }
  return 'v:' + canon(el)
}

const supprime = el => estObjet(el) && el._deleted === true

// Tableaux dont les éléments d'un même lot forment un TOUT cohérent (périodes du barème qui se suivent sans
// chevauchement, révisions IRL d'un lot) : leurs éléments n'ont pas d'identité stable (le début d'une période,
// l'ancrage au bail changent ; une période remplacée et sa remplaçante partagent la même date). Une fusion
// élément par élément pouvait laisser deux périodes ouvertes pour un lot (loyer dû faux) ou perdre la période
// vivante. On fusionne donc LOT PAR LOT : un lot modifié d'un seul côté prend ce côté en entier ; un lot modifié
// des deux côtés garde la version du serveur, et le conflit est signalé (relectures adverses du lot B).
export const TABLEAUX_PAR_LOT = new Set(['loyerBareme', 'irlHistorique'])

function fusionParLot (chemin, base, local, distant, conflits) {
  const grouper = arr => {
    const m = new Map()
    for (const el of (Array.isArray(arr) ? arr : [])) {
      const ref = estObjet(el) ? String(el.ref == null ? '' : el.ref).trim().toLowerCase() : ''
      if (!m.has(ref)) m.set(ref, [])
      m.get(ref).push(el)
    }
    return m
  }
  const B = grouper(base), L = grouper(local), D = grouper(distant)
  const sortie = []
  const vues = new Set()
  const choisir = ref => {
    const b = B.get(ref) || [], l = L.get(ref) || [], d = D.get(ref) || []
    if (egalProfond(l, b)) return d
    if (egalProfond(d, b)) return l
    if (egalProfond(l, d)) return d
    conflits.push(chemin.concat(ref).join('.'))
    return d
  }
  for (const ref of D.keys()) { vues.add(ref); sortie.push(...choisir(ref)) }
  for (const ref of L.keys()) { if (vues.has(ref)) continue; vues.add(ref); sortie.push(...choisir(ref)) }
  for (const ref of B.keys()) { if (vues.has(ref)) continue; vues.add(ref); sortie.push(...choisir(ref)) }
  return sortie
}

function fusionTableau (chemin, base, local, distant, conflits) {
  const indexer = arr => {
    const m = new Map()
    const vus = new Map()
    for (const el of (Array.isArray(arr) ? arr : [])) {
      // Deux éléments de même clé dans un tableau restent DISTINCTS (rang d'occurrence) : jamais un élément perdu.
      const k0 = cleElementConfig(chemin, el), n = vus.get(k0) || 0
      vus.set(k0, n + 1)
      m.set(n ? k0 + '#' + n : k0, el)
    }
    return m
  }
  const B = indexer(base), L = indexer(local), D = indexer(distant)
  const sortie = []
  const vues = new Set()
  const decider = (k) => {
    const b = B.get(k), l = L.get(k), d = D.get(k)
    const inB = B.has(k), inL = L.has(k), inD = D.has(k)
    if (!inB) {                                   // ajouté d'un côté ou des deux
      if (inL && inD) {
        if (egalProfond(l, d)) return { garder: true, val: d }
        conflits.push(chemin.concat(k).join('.'))
        return { garder: true, val: supprime(l) ? l : d }
      }
      return { garder: true, val: inD ? d : l }
    }
    const lChange = !inL || !egalProfond(l, b), dChange = !inD || !egalProfond(d, b)
    if (!lChange) return inD ? { garder: true, val: d } : { garder: false }
    if (!dChange) return inL ? { garder: true, val: l } : { garder: false }
    // modifié / supprimé des deux côtés
    if (!inL && !inD) return { garder: false }
    if (!inL || !inD) {                           // supprimé d'un côté, modifié de l'autre : la modification gagne
      conflits.push(chemin.concat(k).join('.'))
      return { garder: true, val: inD ? d : l }
    }
    if (egalProfond(l, d)) return { garder: true, val: d }
    if (supprime(l) || supprime(d)) { conflits.push(chemin.concat(k).join('.')); return { garder: true, val: supprime(d) ? d : l } }
    if (estObjet(l) && estObjet(d) && estObjet(b)) return { garder: true, val: fusionValeur(chemin.concat(k), b, l, d, conflits) }
    conflits.push(chemin.concat(k).join('.'))
    return { garder: true, val: d }
  }
  // ordre : celui du serveur, puis les ajouts locaux dans leur ordre
  for (const k of D.keys()) { vues.add(k); const r = decider(k); if (r.garder) sortie.push(r.val) }
  for (const k of L.keys()) { if (vues.has(k)) continue; vues.add(k); const r = decider(k); if (r.garder) sortie.push(r.val) }
  for (const k of B.keys()) { if (vues.has(k)) continue; vues.add(k); const r = decider(k); if (r.garder) sortie.push(r.val) }
  return sortie
}

function fusionValeur (chemin, base, local, distant, conflits) {
  if (egalProfond(local, base)) return distant
  if (egalProfond(distant, base)) return local
  if (egalProfond(local, distant)) return distant
  if (chemin.length === 1 && TABLEAUX_PAR_LOT.has(chemin[0]) && Array.isArray(local) && Array.isArray(distant)) return fusionParLot(chemin, Array.isArray(base) ? base : [], local, distant, conflits)
  if (Array.isArray(local) && Array.isArray(distant)) return fusionTableau(chemin, Array.isArray(base) ? base : [], local, distant, conflits)
  if (estObjet(local) && estObjet(distant)) return fusionObjet(chemin, estObjet(base) ? base : {}, local, distant, conflits)
  conflits.push(chemin.join('.'))
  return distant
}

function fusionObjet (chemin, base, local, distant, conflits) {
  const sortie = {}
  const cles = new Set([...Object.keys(distant), ...Object.keys(local), ...Object.keys(base)])
  for (const k of cles) {
    const b = base[k], l = local[k], d = distant[k]
    const inB = b !== undefined, inL = l !== undefined, inD = d !== undefined
    let v
    if (!inL && !inD) continue
    if (!inB) v = !inL ? d : !inD ? l : fusionValeur(chemin.concat(k), undefined, l, d, conflits)
    else if (!inL) { if (egalProfond(d, b)) continue; conflits.push(chemin.concat(k).join('.')); v = d }   // supprimé ici, modifié là-bas
    else if (!inD) { if (egalProfond(l, b)) continue; conflits.push(chemin.concat(k).join('.')); v = l }
    else v = fusionValeur(chemin.concat(k), b, l, d, conflits)
    if (v !== undefined) sortie[k] = v
  }
  return sortie
}

// Point d'entrée. base/local/distant : objets (blob de configuration). Renvoie { fusion, conflits }.
export function fusionnerConfig3 ({ base, local, distant }) {
  const conflits = []
  const fusion = fusionObjet([], estObjet(base) ? base : {}, estObjet(local) ? local : {}, estObjet(distant) ? distant : {}, conflits)
  return { fusion, conflits }
}
