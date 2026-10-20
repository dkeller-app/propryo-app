// js/core/demo-nuage.js — COMPTE DÉMO (?demo=1) : le « nuage » FICTIF de la démonstration.
//
// En démo, il n'y a ni connexion ni Supabase (le script du <head> d'index.html ferme le réseau). Or l'espace locataire
// et le circuit d'un incident lisent leurs liens, documents publiés, messages, signalements, liens d'artisan et devis
// dans des tables du cloud (migrations 0059 / 0060), via deux accès bornés posés par supabase-entry.js :
// window.__immoEspaceLoc et window.__immoIncidentCircuit. Ce module fournit les MÊMES deux interfaces, servies par des
// tables en mémoire, persistées dans un stockage local de la démo (js/app/demo-app.js) : les modules de l'app tournent
// sans aucune modification, et rien ne quitte le navigateur.
//
// Pur : aucune dépendance au DOM, au réseau ni au stockage — tout passe par les fonctions injectées (testé par
// __tests__/helpers/demo-nuage.test.js). Mêmes listes blanches de tables et de fonctions que supabase-entry.js.

export const NUAGE_VERSION = 1
export const TABLES_EL = Object.freeze(['locataire_acces', 'locataire_documents', 'locataire_messages', 'locataire_signalements'])
export const RPC_EL = Object.freeze(['el_acces_emettre', 'el_acces_renouveler', 'el_acces_revoquer', 'el_peut_publier'])
export const TABLES_IC = Object.freeze(['artisan_acces', 'artisan_depots', 'locataire_signalements'])
export const RPC_IC = Object.freeze(['ar_acces_emettre', 'ar_acces_revoquer', 'ar_acces_valider', 'ar_devis_decider'])
const TOUTES = ['locataire_acces', 'locataire_documents', 'locataire_messages', 'locataire_signalements', 'artisan_acces', 'artisan_depots']

const copie = (x) => JSON.parse(JSON.stringify(x))
const erreur = (message, code) => Object.assign(new Error(message), code ? { code } : {})

/** État vide (toutes les tables, aucun fichier). */
export function etatVide() {
  const tables = {}
  for (const t of TOUTES) tables[t] = []
  return { v: NUAGE_VERSION, tables, fichiers: {} }
}

/** État relu du stockage : forme vérifiée, sinon null (à resemer). */
export function lireEtat(json) {
  try {
    const e = typeof json === 'string' ? JSON.parse(json) : json
    if (!e || e.v !== NUAGE_VERSION || !e.tables || typeof e.tables !== 'object') return null
    for (const t of TOUTES) if (!Array.isArray(e.tables[t])) return null
    if (!e.fichiers || typeof e.fichiers !== 'object') e.fichiers = {}
    return e
  } catch (err) { return null }
}

/** Chemin de stockage fictif d'un fichier de la démo (même forme que le cloud : <espace>/<structure>/files/<nom>). */
export const cheminDemo = (espaceId, nom) => String(espaceId) + '/_demo/files/' + String(nom).replace(/[^A-Za-z0-9._-]/g, '_')

/**
 * Sème le nuage à partir du PLAN du jeu de données (js/app/demo-dataset.js, champ `nuage`).
 * @param {object} plan   { acces, messages, signalements, artisanAcces, depots, documents? }
 * @param {object} ctx
 * @param {string} ctx.espaceId
 * @param {(ref:string)=>({bail_id,bail_debut,logement_id,entite_id,fin_bail}|null)} ctx.location  location EN COURS d'un logement
 * @param {(ref:string, acces:object)=>Array<{cle,type_doc,titre,periode?,date_doc?}>} [ctx.documentsVoulus]  documents déjà publiés
 * @param {(sig:object)=>(object|null)} [ctx.resultat]  résultat publié au locataire pour un signalement terminé
 * @returns {object} état
 */
export function semerNuage(plan, ctx) {
  const c = ctx || {}, p = plan || {}, e = etatVide(), T = e.tables
  const esp = c.espaceId
  const accesParId = new Map()
  for (const a of p.acces || []) {
    const loc = c.location ? c.location(a.ref) : null
    if (!loc || !loc.bail_id) continue   // bail introuvable : l'accès n'est pas semé (jamais un accès orphelin)
    const row = { id: a.id, espace_id: esp, entite_id: loc.entite_id || null, logement_id: loc.logement_id || null, bail_id: loc.bail_id,
      bail_debut: loc.bail_debut || null, locataire_rang: a.rang || 0, locataire_nom: a.nom, emis_le: a.emis_le, revoque_le: a.revoque_le || null,
      fin_bail: loc.fin_bail || null, comptes_clos_le: null, derniere_visite: a.derniere_visite || null,
      accord_quittance_le: a.accord_quittance_le || null, accord_quittance_version: a.accord_quittance_le ? (a.accord_quittance_version || 'v1') : null,
      accord_quittance_code: null, accord_retire_le: null, jeton_sha256: null }
    T.locataire_acces.push(row); accesParId.set(row.id, { row, ref: a.ref })
  }
  let n = 0
  const id = (pref) => 'de300000-0000-4000-8000-' + String(pref) + String(++n).padStart(12 - String(pref).length, '0')
  for (const m of p.messages || []) {
    if (!accesParId.has(m.acces)) continue
    T.locataire_messages.push({ id: m.id || id('d'), acces_id: m.acces, auteur: m.auteur === 'bailleur' ? 'bailleur' : 'locataire', corps: String(m.corps || ''),
      pieces: [], cree_le: m.cree_le, lu_bailleur_le: m.lu ? m.cree_le : null, signalement_id: m.signalement || null })
  }
  for (const s of p.signalements || []) {
    const a = accesParId.get(s.acces); if (!a) continue
    const row = { id: s.id, acces_id: s.acces, espace_id: esp, bail_id: a.row.bail_id, piece: s.piece, element: s.element, urgence: s.urgence,
      description: String(s.description || ''), photos: [], ia: s.ia || null, tel_partage: !!s.tel_partage, telephone: s.telephone || null,
      acces_info: s.acces_info || null, presence: s.presence || null, resultat: null, resultat_publie_le: null,
      incident_legacy_id: s.incident || null, importe_le: s.importe_le || null, cree_le: s.cree_le }
    if (s.resultatDe != null && c.resultat) { const r = c.resultat(s); if (r) { row.resultat = r; row.resultat_publie_le = r.publieLe || null } }
    T.locataire_signalements.push(row)
  }
  if (c.documentsVoulus) {
    for (const { row, ref } of accesParId.values()) {
      if (row.locataire_rang !== 0) continue   // une publication par location (pas par colocataire)
      for (const d of c.documentsVoulus(ref, row) || []) {
        if (!d || !d.cle || T.locataire_documents.some((x) => x.bail_id === row.bail_id && x.bail_debut === row.bail_debut && x.cle === d.cle)) continue
        T.locataire_documents.push({ id: id('e'), espace_id: esp, bail_id: row.bail_id, bail_debut: row.bail_debut, cle: d.cle, type_doc: d.type_doc,
          titre: String(d.titre || '').slice(0, 200), periode: d.periode || null, date_doc: d.date_doc || null, storage_path: cheminDemo(esp, 'el_' + d.cle + '.pdf'),
          mime: 'application/pdf', taille: null, sha256: null, parent_id: null, visible_jusqu_au: null, publie_le: d.publie_le || row.emis_le, retire_le: null })
      }
    }
  }
  const arParId = new Map()
  for (const x of p.artisanAcces || []) {
    const row = Object.assign({ espace_id: esp, artisan_nom: '', artisan_email: null, artisan_tel: null, metier: null, plafond_ttc: null, emis_le: null,
      revoque_le: null, valide_le: null, derniere_visite: null, creneau_date: null, creneau_debut: null, creneau_fin: null, creneau_confirme_le: null,
      creneau_accord_expres: null, constat: null, constat_sous_type: null, constat_ampleur: null, constat_resume: null, constat_le: null, signalement_id: null },
    copie(x), { incident_legacy_id: String(x.incident), signalement_id: x.signalement || null })
    delete row.incident; delete row.signalement
    T.artisan_acces.push(row); arParId.set(row.id, row)
  }
  for (const d of p.depots || []) {
    if (!arParId.has(d.acces)) continue
    const path = cheminDemo(esp, 'ar_' + d.id + '_' + (d.nom || 'document'))
    T.artisan_depots.push({ id: d.id, acces_id: d.acces, type_depot: d.type_depot, storage_path: path, nom: d.nom || null, mime: 'application/pdf',
      montant_ttc: d.montant_ttc == null ? null : Number(d.montant_ttc), numero: d.numero || null, statut: d.statut || null, decide_le: d.decide_le || null, cree_le: d.cree_le })
    if (d.fichier) e.fichiers[path] = d.fichier
  }
  return e
}

/** Projection « a,b,c » (colonnes demandées), « * » ou vide = toutes. */
function projeter(row, colonnes) {
  const cols = String(colonnes || '*').split(',').map((s) => s.trim()).filter(Boolean)
  if (!cols.length || cols.includes('*')) return copie(row)
  const o = {}
  for (const k of cols) o[k] = row[k] === undefined ? null : copie(row[k])
  return o
}
function correspond(row, filtres) {
  for (const [k, v] of Object.entries(filtres || {})) {
    if (Array.isArray(v)) { if (!v.includes(row[k])) return false }
    else if (v === null) { if (row[k] != null) return false }
    else if (row[k] !== v) return false
  }
  return true
}

/**
 * Les deux accès bornés de la démo, branchés sur un état (semé ou relu).
 * @param {object} o
 * @param {object} o.etat
 * @param {(etat:object)=>void} o.sauver           persistance (stockage local de la démo)
 * @param {string} o.espaceId
 * @param {()=>string} [o.maintenant]              horloge (figée en démo)
 * @param {()=>string} [o.nouvelId]                uuid d'une nouvelle ligne
 * @param {(collection, cle, entiteNom)=>string} [o.uuid]   même dérivation que le cloud (bail, logement)
 * @param {(bailId:string)=>(object|null)} [o.infoBail]     { bail_debut, logement_id, entite_id, fin_bail } d'une ligne `baux`
 * @param {(path, blob, mime)=>Promise<void>} [o.deposer]   fichier déposé (pièce d'un message, PDF publié)
 */
export function creerNuage(o) {
  const etat = o.etat, T = etat.tables
  const maintenant = o.maintenant || (() => new Date().toISOString())
  let seq = 0
  const nouvelId = o.nouvelId || (() => 'de300000-0000-4000-8000-f' + String(Date.now() % 1e9).padStart(9, '0') + String(++seq % 100).padStart(2, '0'))
  const sauver = () => { try { o.sauver && o.sauver(etat) } catch (e) { /* stockage plein : l'état reste en mémoire pour la séance */ } }
  const table = (liste, t) => { if (!liste.includes(t)) throw erreur('table hors périmètre : ' + t); return T[t] }
  const select = (liste) => async (t, filtres, colonnes) => table(liste, t).filter((r) => correspond(r, filtres)).map((r) => projeter(r, colonnes))
  const parId = (t, id) => T[t].find((r) => r.id === id) || null

  const espaceLoc = {
    pret: () => true,
    uuid: (collection, cle, entiteNom) => { try { return o.uuid ? o.uuid(collection, cle, entiteNom) : null } catch (e) { return null } },
    entiteUuid: () => null,
    espaceDeSeg: () => o.espaceId,
    espacePropre: () => o.espaceId,
    select: select(TABLES_EL),
    insert: async (t, row) => {
      table(TABLES_EL, t)
      const r = Object.assign({}, copie(row), { id: nouvelId(), cree_le: maintenant() })
      if (t === 'locataire_documents') {
        if (T[t].some((x) => x.bail_id === r.bail_id && (x.bail_debut || null) === (r.bail_debut || null) && x.cle === r.cle)) throw erreur('duplicate key', '23505')
        r.publie_le = maintenant(); r.retire_le = null
      }
      if (t === 'locataire_messages') r.lu_bailleur_le = null
      T[t].push(r); sauver(); return copie(r)
    },
    update: async (t, id, patch, garde) => {
      table(TABLES_EL, t)
      const r = parId(t, id); if (!r) return []
      for (const k of Object.keys(garde || {})) if (r[k] != null) return []   // mise à jour CONDITIONNELLE (colonne encore vide)
      Object.assign(r, copie(patch)); sauver(); return [copie(r)]
    },
    rpc: async (fn, a) => {
      if (!RPC_EL.includes(fn)) throw erreur('fonction hors espace locataire')
      const args = a || {}
      if (fn === 'el_peut_publier') return true
      if (fn === 'el_acces_emettre') {
        const info = o.infoBail ? o.infoBail(args.p_bail_id) : null
        if (!info) throw erreur('el:bail-inconnu')
        const nom = String(args.p_nom || '').trim()
        const ancien = T.locataire_acces.find((x) => x.bail_id === args.p_bail_id && (x.bail_debut || null) === (info.bail_debut || null) && x.locataire_nom.toLowerCase() === nom.toLowerCase())
        if (ancien) { Object.assign(ancien, { emis_le: maintenant(), revoque_le: null, jeton_sha256: args.p_jeton_sha256 || null, derniere_visite: null }); sauver(); return ancien.id }
        const r = { id: nouvelId(), espace_id: o.espaceId, entite_id: info.entite_id || null, logement_id: info.logement_id || null, bail_id: args.p_bail_id,
          bail_debut: info.bail_debut || null, locataire_rang: Number(args.p_rang) || 0, locataire_nom: nom, emis_le: maintenant(), revoque_le: null,
          fin_bail: info.fin_bail || null, comptes_clos_le: null, derniere_visite: null, accord_quittance_le: null, accord_quittance_version: null,
          accord_quittance_code: null, accord_retire_le: null, jeton_sha256: args.p_jeton_sha256 || null }
        T.locataire_acces.push(r); sauver(); return r.id
      }
      const x = parId('locataire_acces', args.p_acces_id); if (!x) throw erreur('el:acces-inconnu')
      if (fn === 'el_acces_renouveler') Object.assign(x, { emis_le: maintenant(), revoque_le: null, jeton_sha256: args.p_jeton_sha256 || null, derniere_visite: null })
      else Object.assign(x, { revoque_le: maintenant() })
      sauver(); return null
    },
    upload: async (path, blob, mime) => { if (o.deposer) await o.deposer(path, blob, mime); etat.fichiers[path] = 'demo_nuage:' + path; sauver(); return path },
  }

  const incidentCircuit = {
    pret: () => true,
    espacePropre: () => o.espaceId,
    espaceDeSeg: () => o.espaceId,
    select: select(TABLES_IC),
    publierResultat: async (signalementId, resultat) => {
      const r = parId('locataire_signalements', signalementId); if (!r) return false
      r.resultat = copie(resultat); r.resultat_publie_le = maintenant(); sauver(); return true
    },
    rpc: async (fn, a) => {
      if (!RPC_IC.includes(fn)) throw erreur('fonction hors circuit incident')
      const args = a || {}
      if (fn === 'ar_acces_emettre') {
        for (const x of T.artisan_acces) if (x.incident_legacy_id === String(args.p_incident_legacy_id) && !x.revoque_le) x.revoque_le = maintenant()
        const r = { id: nouvelId(), espace_id: args.p_espace_id || o.espaceId, incident_legacy_id: String(args.p_incident_legacy_id), signalement_id: args.p_signalement_id || null,
          artisan_nom: String(args.p_artisan_nom || ''), artisan_email: args.p_artisan_email || null, artisan_tel: args.p_artisan_tel || null, metier: args.p_metier || null,
          plafond_ttc: args.p_plafond_ttc == null ? null : Number(args.p_plafond_ttc), emis_le: maintenant(), revoque_le: null, valide_le: null, derniere_visite: null,
          creneau_date: null, creneau_debut: null, creneau_fin: null, creneau_confirme_le: null, creneau_accord_expres: null, constat: null, constat_sous_type: null,
          constat_ampleur: null, constat_resume: null, constat_le: null, jeton_sha256: args.p_jeton_sha256 || null }
        T.artisan_acces.push(r); sauver(); return r.id
      }
      if (fn === 'ar_devis_decider') {
        const d = parId('artisan_depots', args.p_depot_id); if (!d) throw erreur('ar:depot-inconnu')
        if (d.statut !== 'en_attente') throw erreur('ar:deja-decide')
        Object.assign(d, { statut: args.p_accepte ? 'accepte' : 'refuse', decide_le: maintenant() }); sauver(); return null
      }
      const x = parId('artisan_acces', args.p_acces_id); if (!x) throw erreur('ar:acces-inconnu')
      if (fn === 'ar_acces_revoquer') x.revoque_le = maintenant()
      else x.valide_le = x.valide_le || maintenant()
      sauver(); return null
    },
  }

  /** Clé IndexedDB du fichier d'un chemin fictif (devis, facture, pièce déposée), ou null. */
  const fichierDe = (path) => (path && Object.prototype.hasOwnProperty.call(etat.fichiers, path) ? etat.fichiers[path] : null)
  return { espaceLoc, incidentCircuit, fichierDe }
}
