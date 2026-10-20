// Cœur PUR du renommage d'un bien (logement.ref). Zéro DOM/global/réseau : reçoit `db` en paramètre.
// Reporte la ref dans les 11 rattachements (miroir du patron saveEnt), bloque si bail/EDL signé.
const REF_RE = /^[A-Za-z0-9À-ſ.\-_/ ]{1,60}$/
const norm = s => String(s == null ? '' : s).trim().toLowerCase()

// Format + unicité (norm, tombstones inclus car detUuid est calculé sur norm(ref)) + no-op.
export function validateNewRef(db, oldRef, newRef) {
  if (newRef === oldRef) return { ok: false, code: 'same', error: 'La nouvelle référence est identique à l\'actuelle.' }
  if (!REF_RE.test(newRef)) return { ok: false, code: 'format', error: 'Référence invalide : lettres/chiffres + . - _ / espaces (60 max).' }
  const nn = norm(newRef)
  const clash = (db.logements || []).some(l => l && l.ref && norm(l.ref) === nn)
  if (clash) return { ok: false, code: 'collision', error: 'Cette référence existe déjà (ou est réservée par un bien supprimé).' }
  return { ok: true }
}

// Garde-fou légal : bloque si un bail (courant ou historique) est signé/verrouillé, ou un EDL signé.
export function canRenameLogement(db, ref) {
  const sig = o => o && o.signatures && (o.signatures.locked || o.signatures.signedAt)
  if (sig((db.baux || {})[ref])) return { ok: false, code: 'bail-signe', error: 'Bail signé : la référence est verrouillée pour préserver la valeur juridique.' }
  if ((db.baux_historique || []).some(b => b && (b.ref === ref || b.logement === ref) && sig(b)))
    return { ok: false, code: 'bail-signe', error: 'Bail signé (historique) : la référence est verrouillée.' }
  if ((db.edl || []).some(e => e && e.logement === ref && sig(e)))
    return { ok: false, code: 'edl-signe', error: 'État des lieux signé : la référence est verrouillée.' }
  return { ok: true }
}

// Renomme oldRef → newRef en reportant les 11 rattachements. Retourne { ok, touched, breakdown } ou { ok:false, error }.
export function renameLogementRef(db, oldRef, newRef, opts = {}) {
  const stamp = opts.stamp || (x => { if (x) x._modifiedAt = new Date().toISOString(); return x })
  const v = validateNewRef(db, oldRef, newRef); if (!v.ok) return v
  const g = canRenameLogement(db, oldRef); if (!g.ok) return g

  const breakdown = {}; let touched = 0
  const bump = k => { touched++; breakdown[k] = (breakdown[k] || 0) + 1 }

  ;(db.logements || []).forEach(l => { if (l && !l._deleted && l.ref === oldRef) { l.ref = newRef; stamp(l); bump('logement') } })

  if (db.baux && Object.prototype.hasOwnProperty.call(db.baux, oldRef)) {
    const b = db.baux[oldRef]; delete db.baux[oldRef]
    if (b) { b.ref = newRef; stamp(b) }
    db.baux[newRef] = b; bump('bail')
  }
  ;(db.baux_historique || []).forEach(b => { if (b && !b._deleted && (b.ref === oldRef || b.logement === oldRef)) { if (b.ref === oldRef) b.ref = newRef; if (b.logement === oldRef) b.logement = newRef; stamp(b); bump('baux_historique') } })
  ;(db.mouvements || []).forEach(m => { if (m && !m._deleted && m.qui === oldRef) { m.qui = newRef; stamp(m); bump('mouvement') } })
  ;(db.quittances || []).forEach(q => { if (q && !q._deleted && q.logement === oldRef) { q.logement = newRef; stamp(q); bump('quittance') } })
  ;(db.edl || []).forEach(e => { if (e && !e._deleted && e.logement === oldRef) { e.logement = newRef; stamp(e); bump('edl') } })
  ;(db.assurances || []).forEach(a => { if (a && !a._deleted && a.logement === oldRef) { a.logement = newRef; stamp(a); bump('assurance') } })
  ;(db.mrh || []).forEach(a => { if (a && !a._deleted && a.logement === oldRef) { a.logement = newRef; stamp(a); bump('mrh') } })
  ;(db.agenda || []).forEach(ev => {
    if (ev && !ev._deleted && ev.logement === oldRef) {
      ev.logement = newRef
      if (typeof ev.autoKey === 'string' && ev.autoKey.indexOf(':' + oldRef + ':') !== -1)
        ev.autoKey = ev.autoKey.split(':' + oldRef + ':').join(':' + newRef + ':')
      stamp(ev); bump('agenda')
    }
  })
  ;(db.documents || []).forEach(d => { if (d && !d._deleted && d.parentType === 'logement' && (d.parentRef === oldRef || d.logRef === oldRef)) { if (d.parentRef === oldRef) d.parentRef = newRef; if (d.logRef === oldRef) d.logRef = newRef; stamp(d); bump('document') } })
  ;(db.candidats || []).forEach(c => { if (c && !c._deleted && c.logRef === oldRef) { c.logRef = newRef; stamp(c); bump('candidat') } })
  // TRAVAUX : QUI PAIE ? — le registre des incidents et les pièces de leur dossier suivent la ref.
  ;(db.incidents || []).forEach(i => { if (i && !i._deleted && i.logRef === oldRef) { i.logRef = newRef; stamp(i); bump('incident') } })
  ;(db.documents || []).forEach(d => { if (d && !d._deleted && d.parentType === 'incident' && d.logRef === oldRef) { d.logRef = newRef; stamp(d); bump('document') } })

  // ── Collections du BLOB config (hors tables : persistées par valeur, mais la ref doit suivre sinon
  //    les données du bien deviennent injoignables après renommage). Pas de _stamp (le blob sync en entier).
  if (db.compteursReleves && Object.prototype.hasOwnProperty.call(db.compteursReleves, oldRef)) {
    db.compteursReleves[newRef] = db.compteursReleves[oldRef]; delete db.compteursReleves[oldRef]; bump('compteursReleves')
  }
  if (db.equipements && Object.prototype.hasOwnProperty.call(db.equipements, oldRef)) {
    db.equipements[newRef] = db.equipements[oldRef]; delete db.equipements[oldRef]; bump('equipements')
  }
  ;(db.irlHistorique || []).forEach(h => { if (h && !h._deleted && h.ref === oldRef) { h.ref = newRef; bump('irlHistorique') } })
  ;(db.candidatLinks || []).forEach(c => { if (c && !c._deleted && c.logRef === oldRef) { c.logRef = newRef; bump('candidatLink') } })

  return { ok: true, touched, breakdown }
}
