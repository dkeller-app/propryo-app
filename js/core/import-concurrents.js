/**
 * core/import-concurrents.js — Mappers d'import depuis solutions concurrentes.
 *
 * Sprint 3G IMPORT-CONCURRENTS (P2 onboarding clé V1 commerciale).
 *
 * Cible top 2 marché (sources : comparatif `ImmoTrack_Comparatif_Concurrents_2026.xlsx`)
 *   - Rentila : exports JSON / CSV (logements + locataires + paiements)
 *   - BailFacile : exports XLSX (3 onglets logements/baux/paiements)
 *
 * Pattern :
 *   1. Mapper(rawData) : transforme données concurrent en structure ImmoTrack normalisée
 *      (logements[], baux[], mouvements[])
 *   2. Validator : valide chaque ligne (champs obligatoires, formats)
 *   3. Merger : prévient les doublons, applique au DB existant
 *
 * Hors scope V1 : Qalimo (format propriétaire), ImmobilierLoyer, Smovin.
 *
 * IMPORTANT : ces mappers travaillent sur les formats DOCUMENTÉS PUBLIQUEMENT.
 * Pour les formats EXACTS, l'utilisateur doit fournir un export-exemple anonymisé
 * et le mapper sera ajusté en session dédiée.
 */

// ────────────────────────────────────────────────────────────────────────────
// RENTILA mapper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mappe un export Rentila JSON vers la structure ImmoTrack.
 *
 * Format Rentila attendu (sera ajusté quand exemple fourni) :
 *   {
 *     biens: [{ id, reference, adresse, surface, type, loyer_hc, charges }],
 *     locataires: [{ id, nom, prenom, email, telephone, bien_id }],
 *     baux: [{ id, bien_id, date_debut, date_fin, loyer, charges, depot_garantie }],
 *     paiements: [{ id, bail_id, date, montant, type }]
 *   }
 */
export function _mapRentila(raw, opts = {}) {
  const { entityNom = 'Imported from Rentila', dryRun = false } = opts;
  const errors = [];
  const out = { logements: [], baux: {}, mouvements: [], _meta: { source: 'rentila', importedAt: new Date().toISOString() } };

  if (!raw || typeof raw !== 'object') {
    errors.push('Format invalide : objet attendu');
    return { out, errors, summary: { logements: 0, baux: 0, mouvements: 0 } };
  }

  // Logements
  (raw.biens || []).forEach((b, i) => {
    if (!b.reference) { errors.push(`Bien #${i} : référence manquante`); return; }
    out.logements.push({
      id: 9000000 + i,
      ref: String(b.reference),
      entity: entityNom,
      type: b.type || 'Autre',
      surf: Number(b.surface) || 0,
      adr: b.adresse || '',
      hc: Number(b.loyer_hc) || 0,
      ch: Number(b.charges) || 0,
      notes: 'Importé Rentila ' + new Date().toISOString().slice(0, 10)
    });
  });

  // Locataires : on les attache via les baux (Rentila a une relation 1-N)
  const locByBienId = {};
  (raw.locataires || []).forEach(l => {
    if (l.bien_id != null) {
      if (!locByBienId[l.bien_id]) locByBienId[l.bien_id] = [];
      locByBienId[l.bien_id].push(l);
    }
  });

  // Baux
  (raw.baux || []).forEach((b, i) => {
    const bien = (raw.biens || []).find(x => x.id === b.bien_id);
    if (!bien) { errors.push(`Bail #${i} : bien_id ${b.bien_id} non trouvé`); return; }
    const ref = String(bien.reference);
    const locs = locByBienId[b.bien_id] || [];
    out.baux[ref] = {
      ref,
      entity: entityNom,
      debut: b.date_debut || '',
      fin: b.date_fin || '',
      hc: Number(b.loyer) || 0,
      ch: Number(b.charges) || 0,
      dg: Number(b.depot_garantie) || 0,
      locataires: locs.map(l => ({
        nom: [l.prenom, l.nom].filter(Boolean).join(' '),
        email: l.email || '',
        tel: l.telephone || ''
      }))
    };
  });

  // Mouvements (paiements = loyers encaissés)
  (raw.paiements || []).forEach((p, i) => {
    const bail = (raw.baux || []).find(x => x.id === p.bail_id);
    if (!bail) { errors.push(`Paiement #${i} : bail_id ${p.bail_id} non trouvé`); return; }
    const bien = (raw.biens || []).find(x => x.id === bail.bien_id);
    if (!bien) return;
    out.mouvements.push({
      id: 9100000 + i,
      date: p.date || '',
      cat: 'Loyers encaissés',
      cr: Number(p.montant) || 0,
      db: 0,
      qui: String(bien.reference),
      lib: 'Paiement Rentila ' + (p.type || ''),
      _imported: 'rentila'
    });
  });

  const summary = {
    logements: out.logements.length,
    baux: Object.keys(out.baux).length,
    mouvements: out.mouvements.length
  };

  return { out: dryRun ? null : out, errors, summary };
}

// ────────────────────────────────────────────────────────────────────────────
// BAILFACILE mapper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mappe un export BailFacile XLSX (parsé par SheetJS en arrays of objects).
 *
 * Format BailFacile attendu : 3 onglets
 *   sheet "Logements" : Ref, Adresse, Surface, Type, Loyer HC, Charges, DG
 *   sheet "Baux" : Ref Logement, Locataire, Email, Téléphone, Date début, Date fin, Loyer, Charges
 *   sheet "Paiements" : Ref Logement, Date, Montant, Type
 */
export function _mapBailFacile(workbookSheets, opts = {}) {
  const { entityNom = 'Imported from BailFacile' } = opts;
  const errors = [];
  const out = { logements: [], baux: {}, mouvements: [], _meta: { source: 'bailfacile', importedAt: new Date().toISOString() } };

  if (!workbookSheets || typeof workbookSheets !== 'object') {
    errors.push('Format invalide : workbook attendu (sheets dict)');
    return { out, errors, summary: { logements: 0, baux: 0, mouvements: 0 } };
  }

  // Logements
  const logSheet = workbookSheets['Logements'] || workbookSheets['logements'] || [];
  logSheet.forEach((row, i) => {
    const ref = row['Ref'] || row['Référence'] || row['ref'];
    if (!ref) { errors.push(`Logement L${i+2} : Ref manquante`); return; }
    out.logements.push({
      id: 9200000 + i,
      ref: String(ref),
      entity: entityNom,
      type: row['Type'] || 'Autre',
      surf: Number(row['Surface']) || 0,
      adr: row['Adresse'] || '',
      hc: Number(row['Loyer HC'] || row['Loyer']) || 0,
      ch: Number(row['Charges']) || 0,
      dg: Number(row['DG']) || 0,
      notes: 'Importé BailFacile ' + new Date().toISOString().slice(0, 10)
    });
  });

  // Baux
  const bailSheet = workbookSheets['Baux'] || workbookSheets['baux'] || [];
  bailSheet.forEach((row, i) => {
    const ref = row['Ref Logement'] || row['ref_logement'] || row['Ref'];
    if (!ref) { errors.push(`Bail L${i+2} : Ref Logement manquante`); return; }
    const refStr = String(ref);
    out.baux[refStr] = {
      ref: refStr,
      entity: entityNom,
      debut: row['Date début'] || row['date_debut'] || '',
      fin: row['Date fin'] || row['date_fin'] || '',
      hc: Number(row['Loyer'] || row['Loyer HC']) || 0,
      ch: Number(row['Charges']) || 0,
      locataires: [{
        nom: row['Locataire'] || row['locataire'] || '',
        email: row['Email'] || '',
        tel: row['Téléphone'] || row['Telephone'] || ''
      }]
    };
  });

  // Paiements
  const payeSheet = workbookSheets['Paiements'] || workbookSheets['paiements'] || [];
  payeSheet.forEach((row, i) => {
    const ref = row['Ref Logement'] || row['ref_logement'];
    if (!ref) { errors.push(`Paiement L${i+2} : Ref Logement manquante`); return; }
    out.mouvements.push({
      id: 9300000 + i,
      date: row['Date'] || '',
      cat: 'Loyers encaissés',
      cr: Number(row['Montant']) || 0,
      db: 0,
      qui: String(ref),
      lib: 'Paiement BailFacile ' + (row['Type'] || ''),
      _imported: 'bailfacile'
    });
  });

  const summary = {
    logements: out.logements.length,
    baux: Object.keys(out.baux).length,
    mouvements: out.mouvements.length
  };

  return { out, errors, summary };
}

// ────────────────────────────────────────────────────────────────────────────
// Merger : applique les données importées à la DB existante sans écraser
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fusionne les données importées dans la DB existante.
 *
 * Politique :
 *   - Logement avec ref existante → SKIP (ne pas écraser un logement réel)
 *   - Bail avec ref existante → SKIP
 *   - Mouvement avec date+ref+montant identiques → SKIP (déduplication)
 *
 * @returns {{added: {logements, baux, mouvements}, skipped: {logements, baux, mouvements}}}
 */
export function _mergeImport(db, importedData) {
  if (!db || !importedData) return { added: { logements: 0, baux: 0, mouvements: 0 }, skipped: { logements: 0, baux: 0, mouvements: 0 } };
  if (!db.logements) db.logements = [];
  if (!db.baux) db.baux = {};
  if (!db.mouvements) db.mouvements = [];

  const added = { logements: 0, baux: 0, mouvements: 0 };
  const skipped = { logements: 0, baux: 0, mouvements: 0 };
  const existingRefs = new Set(db.logements.map(l => l.ref));

  (importedData.logements || []).forEach(l => {
    if (existingRefs.has(l.ref)) { skipped.logements++; return; }
    db.logements.push(l);
    existingRefs.add(l.ref);
    added.logements++;
  });

  Object.values(importedData.baux || {}).forEach(b => {
    // F-proto (audit sécu) : une réf '__proto__'/'constructor'/'prototype' dans un fichier importé
    // polluerait le prototype de db.baux au lieu d'ajouter une clé → on rejette ces clés dangereuses.
    if (!b || b.ref === '__proto__' || b.ref === 'constructor' || b.ref === 'prototype') { skipped.baux++; return; }
    if (db.baux[b.ref]) { skipped.baux++; return; }
    db.baux[b.ref] = b;
    added.baux++;
  });

  // Dédup mouvements par signature (date + qui + cr + db)
  const sig = m => `${m.date}|${m.qui}|${m.cr || 0}|${m.db || 0}`;
  const existingSigs = new Set(db.mouvements.map(sig));
  (importedData.mouvements || []).forEach(m => {
    if (existingSigs.has(sig(m))) { skipped.mouvements++; return; }
    db.mouvements.push(m);
    existingSigs.add(sig(m));
    added.mouvements++;
  });

  return { added, skipped };
}
