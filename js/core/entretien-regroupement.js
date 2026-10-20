/**
 * js/core/entretien-regroupement.js — RETOURS 15/10 (lot 2, point 2) : une seule échéance annuelle
 * « entretien + ramonage » pour les appareils dont l'entretien et le ramonage sont faits par le même
 * professionnel, dans la même visite (décision de Didier du 15/10, recommandation D3) :
 *   - poêle à granulés  : POELE_GRAN_ENT + POELE_GRAN_RAM → POELE_GRAN
 *   - insert / foyer fermé : INSERT_ENT + INSERT_RAM      → INSERT
 * Pas les chaudières fioul / bois (régime des chaudières, chauffagiste ; ramonage par un ramoneur), ni la
 * cheminée ouverte (pas d'entretien obligatoire, C. santé publ. art. R. 1331-14 al. 2).
 *
 * MIGRATION DES DONNÉES (règle projet : migrer, pas tolérer), idempotente, sans rien perdre :
 *   - DB.equipements[ref] : les deux échéances deviennent une. Date retenue = la PLUS ANCIENNE des deux (D6 :
 *     l'échéance tombe au plus tôt), intervenant = celui de l'intervention la plus récente, les deux anciennes
 *     fiches sont conservées dans `regroupeDe` et résumées dans les notes ;
 *   - pièces jointes d'équipement (parentId `ref__CLE`) re-rattachées à la nouvelle clé ;
 *   - événements d'agenda automatiques NON FAITS des anciennes clés retirés (régénérés par agendaAutoSync
 *     sous la nouvelle clé). Les événements faits restent (historique).
 *   - libellé changé sans changement de clé (poêle à bois, D5) : les événements automatiques non faits encore
 *     titrés avec l'ancien libellé sont retirés pour être régénérés avec le nouveau titre et la nouvelle base.
 *
 * Module pur : mute l'objet `db` reçu (comme les autres migrations de démarrage) et rend un résumé ; l'horodatage
 * des documents passe par `opts.stamp` (injecté par l'app : _stamp).
 */

export const REGROUPEMENTS = [
  { cle: 'POELE_GRAN', libelle: 'Entretien + ramonage poêle à granulés', anciennes: { entretien: 'POELE_GRAN_ENT', ramonage: 'POELE_GRAN_RAM' } },
  { cle: 'INSERT', libelle: 'Entretien + ramonage insert / foyer fermé', anciennes: { entretien: 'INSERT_ENT', ramonage: 'INSERT_RAM' } },
]

// Libellés changés SANS changer de clé : clé → ancien début de titre des événements d'agenda automatiques.
export const LIBELLES_CHANGES = { POELE_BOIS_RAM: 'Ramonage poêle à bois' }

const ANCIENNES = REGROUPEMENTS.flatMap(g => Object.values(g.anciennes))

const dateFr = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? m[3] + '/' + m[2] + '/' + m[1] : ''
}

/** Fusionne deux fiches d'intervention (entretien, ramonage) en une seule ; rend null si aucune. */
export function fusionnerFiches(entretien, ramonage, now) {
  const ent = entretien && typeof entretien === 'object' ? entretien : null
  const ram = ramonage && typeof ramonage === 'object' ? ramonage : null
  if (!ent && !ram) return null
  const datees = [ent, ram].filter(f => f && /^\d{4}-\d{2}-\d{2}/.test(String(f.lastDate || '')))
  const lastDate = datees.length ? datees.map(f => String(f.lastDate).slice(0, 10)).sort()[0] : ''
  const recente = datees.length ? datees.slice().sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)))[0] : (ent || ram)
  const interv = (recente && recente.interv) || (ent && ent.interv) || (ram && ram.interv) || ''
  const quand = (f) => (f && f.lastDate ? 'le ' + dateFr(f.lastDate) : 'non enregistré')
  const resume = 'Repris de deux échéances regroupées : entretien ' + quand(ent) + ', ramonage ' + quand(ram) + '.'
  const notes = [resume].concat([ent, ram].map(f => (f && f.notes ? String(f.notes).trim() : '')).filter(Boolean))
  const vues = new Set()
  return {
    lastDate,
    interv,
    notes: notes.filter(n => (vues.has(n) ? false : vues.add(n))).join('\n'),
    updatedAt: now,
    regroupeDe: { entretien: ent ? Object.assign({}, ent) : null, ramonage: ram ? Object.assign({}, ram) : null },
  }
}

/**
 * Migration idempotente. `db` = { equipements, documents, agenda } (DB de l'app). Rend
 * { equipements: [refs modifiées], documents: [ids re-rattachés], agendaRetires: n, change: bool }.
 */
export function regrouperEntretiens(db, opts = {}) {
  const now = opts.now || new Date().toISOString()
  const stamp = typeof opts.stamp === 'function' ? opts.stamp : null
  const res = { equipements: [], documents: [], agendaRetires: 0, agendaConvertis: 0, change: false }
  if (!db || typeof db !== 'object') return res

  // 1. Fiches d'intervention par logement
  const eq = db.equipements && typeof db.equipements === 'object' ? db.equipements : {}
  for (const ref of Object.keys(eq)) {
    const e = eq[ref]
    if (!e || typeof e !== 'object') continue
    let touche = false
    for (const g of REGROUPEMENTS) {
      const { entretien, ramonage } = g.anciennes
      if (!(entretien in e) && !(ramonage in e)) continue
      // Déjà regroupé (autre appareil, synchronisation) : la fiche regroupée fait foi… sauf si une ancienne fiche porte une
      // intervention PLUS RÉCENTE (saisie sur un appareil encore en ancienne version) : elle est reportée, jamais perdue
      // (relecture Fable B2).
      if (!e[g.cle]) {
        const f = fusionnerFiches(e[entretien], e[ramonage], now)
        if (f) e[g.cle] = f
      } else {
        const cur = e[g.cle]
        for (const [quoi, k] of [['entretien', entretien], ['ramonage', ramonage]]) {
          const old = e[k]
          if (!old || !/^\d{4}-\d{2}-\d{2}/.test(String(old.lastDate || ''))) continue
          if (String(old.lastDate).slice(0, 10) <= String(cur.lastDate || '').slice(0, 10)) continue
          cur.lastDate = String(old.lastDate).slice(0, 10)
          if (old.interv) cur.interv = old.interv
          cur.notes = [String(cur.notes || '').trim(), 'Repris d\'une saisie « ' + quoi + ' » du ' + dateFr(old.lastDate) + ' (ancienne version de l\'app).', String(old.notes || '').trim()].filter(Boolean).join('\n')
          cur.updatedAt = now
          cur.regroupeDe = Object.assign({}, cur.regroupeDe, { ['saisieTardive_' + quoi]: Object.assign({}, old) })
        }
      }
      delete e[entretien]
      delete e[ramonage]
      touche = true
    }
    if (touche) res.equipements.push(ref)
  }

  // 2. Pièces jointes d'équipement : parentId `ref__CLE`
  const versCle = {}, libelleDe = {}
  for (const g of REGROUPEMENTS) { libelleDe[g.cle] = g.libelle; for (const k of Object.values(g.anciennes)) versCle[k] = g.cle }
  for (const d of Array.isArray(db.documents) ? db.documents : []) {
    if (!d || d._deleted || d.parentType !== 'equipement' || d.parentId == null) continue
    const pid = String(d.parentId)
    const i = pid.lastIndexOf('__')
    if (i < 0) continue
    const k = pid.slice(i + 2)
    if (!versCle[k]) continue
    d.parentId = pid.slice(0, i) + '__' + versCle[k]
    // Libellé affiché de la pièce (« réf · type d'équipement ») : le nouveau libellé, comme une pièce jointe neuve.
    if (typeof d.parentRef === 'string' && d.parentRef.indexOf(' · ') >= 0) d.parentRef = d.parentRef.slice(0, d.parentRef.indexOf(' · ')) + ' · ' + libelleDe[versCle[k]]
    if (stamp) stamp(d)
    res.documents.push(d.id)
  }

  // 3. Agenda : événements automatiques non faits des anciennes clés (ou à l'ancien libellé), et — pour les logements
  //    migrés à l'instant — ceux de la NOUVELLE clé : au premier démarrage hors cloud, agendaAutoSync a pu les créer AVANT la
  //    migration, datés depuis le début du bail faute de fiche ; ils sont régénérés juste après avec la bonne date
  //    (relecture Fable B1). Au passage suivant, aucun logement n'est migré : pas de boucle.
  const migres = new Set(res.equipements)
  const nouvelles = REGROUPEMENTS.map(g => g.cle)
  if (Array.isArray(db.agenda) && db.agenda.length) {
    const avant = db.agenda.length
    db.agenda = db.agenda.filter(ev => {
      if (!ev || !ev.auto || ev.done || typeof ev.autoKey !== 'string' || ev.autoKey.indexOf('EQUIP:') !== 0) return true
      const parts = ev.autoKey.split(':')   // EQUIP:<ref>:<clé>:<date> — la clé est l'avant-dernier segment
      const k = parts[parts.length - 2]
      const aRetirer = ANCIENNES.includes(k)
        || (nouvelles.includes(k) && migres.has(parts.slice(1, parts.length - 2).join(':')))
        || (!!LIBELLES_CHANGES[k] && String(ev.titre || '').indexOf(LIBELLES_CHANGES[k]) === 0)
      if (!aRetirer) return true
      // Rappel déplacé par l'utilisateur (date ≠ date de la clé) : ce qu'il a choisi est gardé, comme un événement manuel
      // (relecture adverse 15/10) ; seuls les rappels intacts sont retirés pour être régénérés.
      if (ev.date && ev.date !== parts[parts.length - 1]) { ev.auto = false; if (stamp) stamp(ev); res.agendaConvertis++; return true }
      return false
    })
    res.agendaRetires = avant - db.agenda.length
  }

  res.change = res.equipements.length > 0 || res.documents.length > 0 || res.agendaRetires > 0 || res.agendaConvertis > 0
  return res
}
