// js/core/decompte-restitution.js — DÉCOMPTE DE RESTITUTION du dépôt de garantie remis au locataire (F-26, lot C,
// décision Didier 17/10).
//
// Avant : la restitution ENREGISTRAIT le solde de tout compte (retenues, retenue pour loyer, majoration de l'art. 22)
// mais aucun document ne le portait au locataire ; la majoration due au locataire n'était écrite nulle part.
// Ici : un décompte LU dans ce qui a été enregistré (jamais recalculé ailleurs) — dépôt versé, retenues détaillées
// (grille de vétusté + autres retenues), retenue pour loyer, majoration art. 22, montant net rendu, date.
//
// Module PUR : aucune dépendance au DOM ni à DB. Le HTML est échappé ici (le document sort en PDF natif, mais il est
// aussi aperçu dans l'app).

const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * @param {object} bail       bail tel qu'enregistré par la restitution (dgRetenu, dgRetenueLoyer, dgPenaliteArt22,
 *                            dgRestitueMontant, dgRestitueAt, dgDetailRetenues, depart.vetusteLignes / autresRetenues)
 * @param {number} depotVerse    dépôt effectivement versé (lecteur unique de l'app : _dgVerseMontant)
 * @returns {{ depotVerse, retenues: {libelle, montant}[], totalRetenues, retenueLoyer, majoration, net, resteDu,
 *            netEnregistre, ecart, dateRestitution, enregistre }}
 */
export function decompteRestitution (bail, depotVerse) {
  const b = bail || {}
  const dep = b.depart || {}
  const retenues = []
  const lignes = Array.isArray(dep.vetusteLignes) ? dep.vetusteLignes : []
  // Ce qui est RETENU par ligne = la part du locataire après vétusté (`part`, enregistrée depuis le lot C), jamais le
  // coût de remplacement. Restitution enregistrée avant : pas de part par ligne → une ligne globale « réparations ».
  const avecParts = lignes.length && lignes.every(l => l && l.part != null)
  if (avecParts) {
    for (const l of lignes) {
      const m = r2(l.part)
      if (!m) continue
      const lib = [l.piece, l.type].filter(Boolean).join(' — ') || 'Réparation locative'
      const det = (l.usurePct != null && Number(l.usurePct) > 0) ? ' (coût ' + r2(l.cout).toFixed(2) + ' €, vétusté ' + Number(l.usurePct) + ' %)' : ''
      retenues.push({ libelle: lib + det, montant: m })
    }
  } else {
    const rep = r2(dep.reparations != null ? dep.reparations : (Number(b.dgRetenu) || 0) - (Number(dep.autresRetenues) || 0))
    if (rep > 0) retenues.push({ libelle: 'Réparations locatives (part du locataire après vétusté)', montant: rep })
  }
  const autres = r2(dep.autresRetenues)
  if (autres) retenues.push({ libelle: 'Autres retenues' + (b.dgDetailRetenues ? ' : ' + b.dgDetailRetenues : ''), montant: autres })
  const totalRetenues = r2(retenues.reduce((s, x) => s + x.montant, 0))
  const majoration = r2(b.dgPenaliteArt22)
  const dg = r2(depotVerse)
  // Retenue pour loyer : enregistrée depuis le 17/10 ; avant, elle est ce que le montant restitué a déduit en plus des
  // retenues (jamais négative) — le décompte d'une restitution ancienne reste ainsi juste et sans écart.
  const _enr = b.dgRestitueMontant != null && b.dgRestitueMontant !== ''
  const retenueLoyer = (b.dgRetenueLoyer != null && b.dgRetenueLoyer !== '') ? r2(b.dgRetenueLoyer)
    : (_enr ? Math.max(0, r2(dg - totalRetenues - (r2(b.dgRestitueMontant) - majoration))) : 0)
  const brut = r2(dg - totalRetenues - retenueLoyer)
  const net = r2(Math.max(0, brut) + majoration)
  const resteDu = brut < 0 ? r2(-brut) : 0
  const enregistre = b.dgRestitueMontant != null && b.dgRestitueMontant !== ''
  const netEnregistre = enregistre ? r2(b.dgRestitueMontant) : null
  return {
    depotVerse: dg, retenues, totalRetenues, retenueLoyer, majoration, net, resteDu,
    netEnregistre, ecart: enregistre ? r2(netEnregistre - net) : 0,
    dateRestitution: b.dgRestitueAt || '', enregistre,
  }
}

/**
 * Corps HTML du décompte (à poser dans le gabarit commun _docPage). `fmt` / `fd` : formateurs de l'app (montant, date).
 * Le montant net affiché est celui ENREGISTRÉ (ce qui a été viré) ; un écart avec le calcul est montré, jamais masqué.
 */
export function decompteRestitutionCorps (d, { fmt, fd, locataire = '', adresseBien = '', dateRemiseCles = '' } = {}) {
  const F = typeof fmt === 'function' ? fmt : (n => r2(n).toFixed(2) + ' €')
  const D = typeof fd === 'function' ? fd : (s => s || '')
  const lg = (lab, val, cls = '') => '<div class="pro-lg' + (cls ? ' ' + cls : '') + '"><span class="lab">' + lab + '</span><span class="val">' + val + '</span></div>'
  const lignes = [lg('Dépôt de garantie versé', esc(F(d.depotVerse)))]
  for (const r of d.retenues) lignes.push(lg('Retenue — ' + esc(r.libelle), '- ' + esc(F(r.montant))))
  if (d.retenueLoyer) lignes.push(lg('Retenue pour loyers impayés', '- ' + esc(F(d.retenueLoyer))))
  if (d.majoration) lignes.push(lg('Majoration pour restitution tardive (art. 22 loi 89-462)', '+ ' + esc(F(d.majoration))))
  const net = d.enregistre ? d.netEnregistre : d.net
  lignes.push(lg('Montant restitué', esc(F(net)), 'tot'))
  const p = []
  p.push('<p>' + (locataire ? 'À l\'attention de ' + esc(locataire) + '. ' : '') + 'Décompte de restitution du dépôt de garantie'
    + (adresseBien ? ' du logement situé ' + esc(adresseBien) : '') + (dateRemiseCles ? ', clés remises le ' + esc(D(dateRemiseCles)) : '') + '.</p>')
  p.push('<div class="pro-lignes">' + lignes.join('') + '</div>')
  if (d.resteDu) p.push('<p class="pro-mention">Les retenues dépassent le dépôt : il reste ' + esc(F(d.resteDu)) + ' à la charge du locataire.</p>')
  if (d.enregistre && Math.abs(d.ecart) >= 0.01) p.push('<p class="pro-mention">Montant enregistré à la restitution ; il diffère de ' + esc(F(Math.abs(d.ecart))) + ' du détail ci-dessus.</p>')
  p.push('<p class="pro-mention">' + (d.dateRestitution ? 'Restitution effectuée le ' + esc(D(d.dateRestitution)) + '.' : 'Date de restitution : à compléter.')
    + ' Le dépôt est restitué dans un délai maximal d\'un mois à compter de la remise des clés lorsque l\'état des lieux de sortie est conforme à celui d\'entrée, de deux mois sinon (art. 22 loi 89-462).</p>')
  return p.join('')
}
