// js/core/store-supabase-adapter.js — Binding supabase-js du Store Supabase.
// Fournit { fetchTable, fetchConfig, writer } à createSupabaseStore(...), branché sur un
// client supabase-js (l'app authentifiée, ou service_role en test).
//
// ⚠️ Implémente VERBATIM le contrat de concurrence de store-supabase.js (sinon réintroduit
//    la perte silencieuse / la résurrection que l'audit a fait corriger) :
//    - fetchTable EXCLUT les soft-deleted (deleted_at IS NULL) et PAGINE (PostgREST plafonne à
//      1000 lignes/requête → une table volumineuse serait tronquée silencieusement sinon).
//    - insert     = upsert ON CONFLICT (id) DO NOTHING → version si inséré, null si CONFLIT.
//                   « Conflit » = id déjà pris OU violation d'un AUTRE index unique (ex. quittances
//                   (logement,mois)) : tout 23505 → null (FAIL-CLOSED, jamais d'écrasement ni de
//                   throw d'un conflit attendu ; l'app re-hydrate puis résout).
//    - update     = WHERE id=? AND version=? AND deleted_at IS NULL → version (post-trigger) si
//                   1 ligne, null sinon (version périmée OU tombstone → pas de résurrection).
//                   Ne réécrit JAMAIS id / version / created_by / legacy_id (provenance immuable).
//    - softDelete = WHERE id=? AND version=? AND deleted_at IS NULL → version si 1 ligne, null sinon
//                   (idempotent : un 2e soft-delete n'écrase pas l'horodatage de suppression).
//    (touch_row bumpe version à chaque UPDATE → la version renvoyée est la NOUVELLE.)

const PAGE_DEFAULT = 1000   // limite PostgREST par défaut
// Tables portant une colonne `locked` (immutabilité légale). reviveTombstone y ajoute `AND locked=false`
// → un signé verrouillé n'est JAMAIS réanimé (fail-closed sans laisser le trigger prevent_locked_mutation throw).
const LOCKED_TABLES = new Set(['baux', 'edl'])

export function createSupabaseAdapter(client, espaceId, opts = {}) {
  const pageSize = opts.pageSize || PAGE_DEFAULT

  // Lecture paginée : boucle .range() jusqu'à une page incomplète (anti-troncature silencieuse).
  async function fetchTable(name) {
    const out = []
    for (let off = 0; ; off += pageSize) {
      let qy = client.from(name)
        .select('id, version, legacy_raw').eq('espace_id', espaceId).is('deleted_at', null)
      // `baux` : seul le bail COURANT de chaque logement devient DB.baux[ref]. Un bail ARCHIVÉ (signé clôturé,
      // supprimé, remplacé — migration 0055) reste au cloud comme preuve mais ne doit JAMAIS revenir comme
      // bail en cours (défaut du 28/09 : le bail clôturé ressuscitait au rechargement, à côté de son archive).
      if (name === 'baux') qy = qy.eq('archived', false)
      const { data, error } = await qy.order('id', { ascending: true }).range(off, off + pageSize - 1)
      if (error) throw new Error('fetchTable ' + name + ': ' + error.message)
      if (!data || data.length === 0) break
      out.push(...data)
      if (data.length < pageSize) break
    }
    return out
  }

  // D2 — CONFIG SCOPÉE : on lit le blob via la RPC SECURITY DEFINER `espace_config_scoped` (migration 0043)
  // et NON plus par un SELECT brut (dont la RLS est désormais is_full_member). Un membre PLEIN reçoit le
  // blob INTÉGRAL (identique à l'ancien SELECT) ; un membre SCOPÉ reçoit le blob FILTRÉ par-SCI côté serveur
  // (irlHistorique/assurances bailleur/compteursReleves réduits aux refs de logement accessibles) → aucune
  // fuite des autres SCIs, et le filtrage n'est JAMAIS fait côté client. Renvoie {} si non membre / vide.
  async function fetchConfig() {
    const { data, error } = await client.rpc('espace_config_scoped', { p_espace_id: espaceId })
    if (error) throw new Error('fetchConfig: ' + error.message)
    return data || {}
  }

  // Écrit le blob config (collections non-tablées) en un seul jsonb par espace. Remplacement
  // complet (pas de concurrence par ligne) : faible volume + faible fréquence → LWW acceptable ici,
  // contrairement aux tables métier (gardées par version). RLS espace_config = has_role(owner|gestionnaire).
  async function writeConfig(data) {
    const { error } = await client.from('espace_config')
      .upsert({ espace_id: espaceId, data }, { onConflict: 'espace_id' })
    if (error) throw new Error('writeConfig: ' + error.message)
    return true
  }

  // Blob config PROPRIÉTAIRE-PRIVÉ (espace_config_private, RLS is_full_member). Un membre SCOPÉ
  // n'a aucun accès : la SELECT renvoie 0 ligne (→ {}), l'UPSERT est refusé (mais le Store ne tente
  // l'écriture privée que si le sous-ensemble privé est non vide — un scopé ne l'a jamais). Volet 3.
  async function fetchConfigPrivate() {
    const { data, error } = await client.from('espace_config_private')
      .select('data').eq('espace_id', espaceId).maybeSingle()
    if (error) throw new Error('fetchConfigPrivate: ' + error.message)
    return (data && data.data) || {}
  }
  async function writeConfigPrivate(data) {
    const { error } = await client.from('espace_config_private')
      .upsert({ espace_id: espaceId, data }, { onConflict: 'espace_id' })
    if (error) throw new Error('writeConfigPrivate: ' + error.message)
    return true
  }

  const writer = {
    // ON CONFLICT (id) DO NOTHING. Tout conflit unique (id OU autre index) → null (jamais d'écrasement).
    async insert(table, row) {
      const { data, error } = await client.from(table)
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select('version')
      if (error) {
        if (error.code === '23505') return null   // unique_violation (id OU 2e index) = CONFLIT attendu → fail-closed
        throw new Error('insert ' + table + ': ' + error.message)
      }
      return data && data.length ? data[0].version : null
    },
    // UPDATE gardé par version + deleted_at IS NULL. 0 ligne → null (périmé/tombstone).
    // Ne touche jamais à la PK, la version (touch_row gère), ni la provenance (created_by/legacy_id).
    async update(table, id, row, expectedVersion) {
      const { id: _pk, version: _v, created_by: _cb, legacy_id: _lid, ...set } = row
      const { data, error } = await client.from(table)
        .update(set).eq('id', id).eq('version', expectedVersion).is('deleted_at', null).select('version')
      if (error) throw new Error('update ' + table + ': ' + error.message)
      return data && data.length ? data[0].version : null
    },
    // ARCHIVAGE d'un bail (migration 0055) : UPDATE de la SEULE colonne `archived`, gardé par version,
    // ligne vivante et non encore archivée. Sur un bail signé verrouillé, c'est la seule écriture que le
    // trigger accepte (toute autre colonne envoyée ici la ferait refuser → on n'envoie QUE archived).
    async archive(table, id, expectedVersion) {
      const { data, error } = await client.from(table)
        .update({ archived: true })
        .eq('id', id).eq('espace_id', espaceId).eq('version', expectedVersion).is('deleted_at', null).eq('archived', false)
        .select('version')
      if (error) throw new Error('archive ' + table + ': ' + error.message)
      if (data && data.length) return data[0].version
      // IDEMPOTENT (audit v15.690, I4) : 0 ligne peut vouloir dire « DÉJÀ archivée » (par un autre appareil,
      // ou par ce flush avant une coupure réseau). Le but est atteint → succès, avec la version actuelle.
      // Sinon (version périmée d'une ligne vivante, ligne supprimée) → null = conflit, comme avant.
      const { data: cur, error: e2 } = await client.from(table)
        .select('version, archived, deleted_at').eq('id', id).eq('espace_id', espaceId).maybeSingle()
      if (e2) throw new Error('archive ' + table + ' (relecture): ' + e2.message)
      return (cur && cur.archived === true && cur.deleted_at == null) ? cur.version : null
    },
    // Soft-delete gardé par version + deleted_at IS NULL (idempotent, jamais de DELETE physique).
    // `extra` (CANDIDATURES-CONFORMITE) : colonnes réécrites dans le MÊME UPDATE — legacy_raw réduit à
    // l'identifiant (+ name null pour une pièce) pour un candidat ou une pièce de candidat, afin que la
    // ligne supprimée ne garde aucune donnée personnelle. Seules legacy_raw et name sont acceptées.
    async softDelete(table, id, expectedVersion, extra) {
      const set = { deleted_at: new Date().toISOString() }
      if (extra && typeof extra === 'object') {
        if ('legacy_raw' in extra) set.legacy_raw = extra.legacy_raw
        if ('name' in extra) set.name = extra.name
      }
      const { data, error } = await client.from(table)
        .update(set)
        .eq('id', id).eq('version', expectedVersion).is('deleted_at', null).select('version')
      if (error) throw new Error('softDelete ' + table + ': ' + error.message)
      return data && data.length ? data[0].version : null
    },
    // B-REBAIL-TOMBSTONE — reviveTombstone : ré-ouvre le slot d'une clé naturelle RE-CRÉÉE délibérément
    // (relocation d'un logement → nouveau bail ; bien recréé même ref). UPDATE ciblé :
    //   SET <payload>, deleted_at=NULL WHERE id=? AND espace_id=? AND deleted_at IS NOT NULL [AND locked=false]
    // → n'agit QUE sur un TOMBSTONE (ligne vivante → 0 ligne → null = conflit, fail-closed), REFUSE un
    // signé verrouillé (baux/edl), et touch_row bumpe la version (renvoyée). PAS de garde de version : on
    // n'en connaît aucune (le tombstone est hors hydrate) — la réouverture est un acte volontaire, gouverné
    // en amont par store-sync (allowRevive = ajout frais uniquement, jamais une édition → pas de résurrection).
    // Concurrence : 2 revives simultanés → le 2e trouve deleted_at IS NULL → 0 ligne → null → re-hydrate.
    // Ne réécrit jamais id/version/created_by/legacy_id (provenance immuable, comme update). NB : le mapper
    // `baux` porte sa clé legacy dans `legacy_ref` (pas `legacy_id`) → non strippé, donc réécrit ici ; en
    // relocation c'est idempotent (même __key = même legacy_ref), jamais un changement de provenance.
    async reviveTombstone(table, id, row) {
      const { id: _pk, version: _v, created_by: _cb, legacy_id: _lid, ...set } = row
      let q = client.from(table).update({ ...set, deleted_at: null })
        .eq('id', id).eq('espace_id', espaceId).not('deleted_at', 'is', null)
      if (LOCKED_TABLES.has(table)) q = q.eq('locked', false)
      const { data, error } = await q.select('version')
      if (error) throw new Error('reviveTombstone ' + table + ': ' + error.message)
      return data && data.length ? data[0].version : null
    },
  }

  // ── CONFIG GARDÉE PAR VERSION (lot B avant bêta) ─────────────────────────────────────────────────
  // Fin du « dernier écrit gagne » : on lit la VERSION de la ligne AVANT son contenu (si le contenu est plus
  // récent que la version lue, l'écriture suivante échoue et fusionne — jamais l'inverse), puis on n'écrit
  // que si la version n'a pas bougé. null = CONFLIT (l'appelant relit, fusionne et réessaie).
  // Partagé : version par SELECT (membre plein, RLS 0043) + contenu par la RPC filtrée (inchangée).
  async function lireConfig() {
    const { data: v, error: e1 } = await client.from('espace_config').select('version').eq('espace_id', espaceId).maybeSingle()
    if (e1) throw new Error('lireConfig: ' + e1.message)
    const data = await fetchConfig()
    return { data: data || {}, version: v ? Number(v.version) : null }
  }
  async function lireConfigPrivee() {
    const { data, error } = await client.from('espace_config_private').select('data, version').eq('espace_id', espaceId).maybeSingle()
    if (error) throw new Error('lireConfigPrivee: ' + error.message)
    return { data: (data && data.data) || {}, version: data ? Number(data.version) : null }
  }
  async function ecrireGardee(table, data, version) {
    if (version == null) {   // aucune ligne connue : création, sans jamais écraser une ligne apparue entre-temps
      const { data: r, error } = await client.from(table)
        .upsert({ espace_id: espaceId, data }, { onConflict: 'espace_id', ignoreDuplicates: true }).select('version')
      if (error) throw new Error('ecrire ' + table + ': ' + error.message)
      return (r && r.length) ? Number(r[0].version) : null
    }
    const { data: r, error } = await client.from(table)
      .update({ data }).eq('espace_id', espaceId).eq('version', version).select('version')
    if (error) throw new Error('ecrire ' + table + ': ' + error.message)
    return (r && r.length) ? Number(r[0].version) : null
  }
  const ecrireConfig = (data, version) => ecrireGardee('espace_config', data, version)
  const ecrireConfigPrivee = (data, version) => ecrireGardee('espace_config_private', data, version)

  return { fetchTable, fetchConfig, writeConfig, fetchConfigPrivate, writeConfigPrivate, lireConfig, lireConfigPrivee, ecrireConfig, ecrireConfigPrivee, writer }
}
