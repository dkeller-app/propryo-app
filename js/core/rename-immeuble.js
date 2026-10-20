// js/core/rename-immeuble.js — Cœur PUR du renommage d'un immeuble (immeuble.nom).
//
// Le lien logement↔immeuble n'est PAS un id : c'est le NOM (string). `logement.imm === immeuble.nom`,
// et les vues groupent par ce nom (« Logements isolés » quand ça ne matche plus). Idem `mouvement.imm`,
// `agenda.immeuble`, `documents{parentType:'immeuble'}.parentRef`, `assurances{portee:'immeuble'}.immeuble`,
// et les clés `regulValidations` « <nom immeuble>|<du>|<au> ». Renommer l'immeuble SANS propager
// oldNom→newNom ORPHELINE tous ses logements (bug v15.483 : rename immeuble → 6 lots « isolés »).
// Jumeau de rename-logement.js pour les biens.
//
// ⚠️ SCOPÉ PAR ESPACE (multi-espace) : l'id de ligne d'un immeuble = detUuid(owner,'immeuble',norm(nom))
// → un nom d'immeuble est unique DANS un espace, mais DEUX espaces peuvent porter le même (ex. la SCI
// SMARTOSAURUS partagée par Marion + l'archive homonyme de Didier). La propagation ne touche QUE les
// records du MÊME espace que l'immeuble renommé. Convention de tag (store-multi) : un record HYDRATÉ porte
// `_espaceId` ; un record CRÉÉ en session n'est pas encore tagué (`null`) et appartient par défaut à
// l'espace PROPRE (cf. store-multi `_viewFor`). Donc un record non tagué compte pour l'espace propre —
// il est inclus SEULEMENT si on renomme un immeuble de l'espace propre (`scopeIsOwn`). Les collections de
// CONFIG (regulValidations, assurances) ne vivent QUE dans l'espace propre → re-keyées seulement si
// `scopeIsOwn`. Mono-espace : aucun tag, `ownEspaceId` null → scope null → tout est « propre », inchangé.

import { appartientAEspace } from './entite-doublon.js'

const norm = s => String(s == null ? '' : s).trim().toLowerCase()

// Un record appartient-il à l'espace CIBLE du renommage ? Tagué → égalité stricte. Non tagué (créé en
// session) → propre → ne compte que si la cible EST l'espace propre. Règle unique : entite-doublon.js.
const makeBelongs = (scope, scopeIsOwn) => x => appartientAEspace(x, scope, scopeIsOwn)

// Validation anti-collision : le nouveau nom ne doit pas être DÉJÀ porté par un AUTRE immeuble du MÊME
// espace (même nom → même uuid déterministe → fusion silencieuse). Renvoie {ok,error}.
export function validateNewImmNom(db, oldNom, newNom, espaceId, ownEspaceId) {
  const nn = norm(newNom)
  if (!nn) return { ok: false, error: 'Nom d\'immeuble requis' }
  if (nn === norm(oldNom)) return { ok: true }                       // inchangé → rien à valider
  const scope = espaceId != null ? espaceId : null
  // scope===null = immeuble NON tagué → créé en session → toujours PROPRE (la création route vers l'espace
  // propre, store-multi) → own, même si ownEspaceId est renseigné (durcissement audit : évite qu'un immeuble
  // propre créé sans reload soit classé tiers).
  const scopeIsOwn = scope == null || scope === (ownEspaceId != null ? ownEspaceId : null)
  const belongs = makeBelongs(scope, scopeIsOwn)
  const clash = (db.entites || []).some(e =>
    Array.isArray(e && e.immeubles) &&
    e.immeubles.some(im => im && !im._deleted && belongs(im) && norm(im.nom) === nn))
  return clash ? { ok: false, error: 'Un immeuble porte déjà ce nom dans cet espace' } : { ok: true }
}

// Propage le renommage sur toutes les RÉFÉRENCES par nom (l'objet immeuble lui-même est mis à jour par
// l'appelant = saveImm). `opts.espaceId` = espace de l'immeuble renommé ; `opts.ownEspaceId` = espace
// propre du user (pour classer les records non tagués + gater la config own-only). `opts.stamp` horodate.
// Renvoie { touched, breakdown }.
export function renameImmeubleRefs(db, oldNom, newNom, opts = {}) {
  const stamp = opts.stamp || (x => { if (x) x._modifiedAt = new Date().toISOString(); return x })
  const scope = opts.espaceId != null ? opts.espaceId : null
  // scope===null (immeuble non tagué = créé en session) → toujours PROPRE (cf. validateNewImmNom).
  const scopeIsOwn = scope == null || scope === (opts.ownEspaceId != null ? opts.ownEspaceId : null)
  const on = norm(oldNom)
  if (!db || on === norm(newNom)) return { touched: 0, breakdown: {} }
  const belongs = makeBelongs(scope, scopeIsOwn)
  let touched = 0; const breakdown = {}
  const bump = k => { touched++; breakdown[k] = (breakdown[k] || 0) + 1 }

  ;(db.logements || []).forEach(l => { if (l && !l._deleted && belongs(l) && norm(l.imm) === on) { l.imm = newNom; stamp(l); bump('logement') } })
  ;(db.mouvements || []).forEach(m => { if (m && !m._deleted && belongs(m) && norm(m.imm) === on) { m.imm = newNom; stamp(m); bump('mouvement') } })
  ;(db.agenda || []).forEach(ev => { if (ev && !ev._deleted && belongs(ev) && norm(ev.immeuble) === on) { ev.immeuble = newNom; stamp(ev); bump('agenda') } })
  // TRAVAUX : QUI PAIE ? — registre des incidents (parties communes rattachées par le nom d'immeuble).
  ;(db.incidents || []).forEach(i => { if (i && !i._deleted && belongs(i) && norm(i.imm) === on) { i.imm = newNom; stamp(i); bump('incident') } })
  ;(db.documents || []).forEach(d => { if (d && !d._deleted && belongs(d) && d.parentType === 'immeuble' && norm(d.parentRef) === on) { d.parentRef = newNom; stamp(d); bump('document') } })
  // assurances BAILLEUR au niveau immeuble (PNO d'ensemble) : liées par NOM via `a.immeuble` (portee
  // 'immeuble'). delImm cascade déjà ce lien → le renommage doit suivre. Config own-only → belongs gère.
  ;(db.assurances || []).forEach(a => { if (a && !a._deleted && belongs(a) && a.portee === 'immeuble' && norm(a.immeuble) === on) { a.immeuble = newNom; stamp(a); bump('assurance') } })

  // regulValidations : objet du BLOB config keyé « <nom immeuble>|<du>|<au> ». La config ne vit QUE dans
  // l'espace PROPRE (store-multi ne fusionne pas la config des tiers) → on ne re-keye QUE si on renomme un
  // immeuble de l'espace propre (`scopeIsOwn`) — sinon renommer un immeuble TIERS homonyme corromprait la
  // clé de régul de l'espace propre (réserve audit). Split au 1er « | » (un nom d'immeuble peut en théorie
  // contenir « | » → on ne matche que le segment avant, comme _rgValKey le construit).
  if (scopeIsOwn && db.regulValidations && typeof db.regulValidations === 'object') {
    for (const k of Object.keys(db.regulValidations)) {
      const i = k.indexOf('|')
      const immPart = i === -1 ? k : k.slice(0, i)
      if (norm(immPart) === on) {
        const nk = newNom + (i === -1 ? '' : k.slice(i))
        if (nk !== k) { db.regulValidations[nk] = db.regulValidations[k]; delete db.regulValidations[k]; bump('regulValidation') }
      }
    }
  }
  return { touched, breakdown }
}
