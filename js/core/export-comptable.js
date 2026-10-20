/**
 * core/export-comptable.js — Exports comptables (Sprint 3E).
 *
 * Formats produits :
 *   - FEC (Fichier des Écritures Comptables) — format obligatoire DGFiP
 *     pour contrôle fiscal (art. L47A LPF). Format texte avec séparateur
 *     tab ou pipe, 18 colonnes normées.
 *   - Journal général (par date + compte + libellé + débit + crédit)
 *   - Grand livre (par compte, soldes mouvementés)
 *
 * Mapping comptable simplifié pour gestion locative :
 *   Compte 411xxx (clients) — locataires
 *   Compte 706000 (prestations services) — loyers
 *   Compte 615xxx (entretien réparations) — travaux
 *   Compte 616xxx (assurances) — PNO, GLI, MRH
 *   Compte 622xxx (honoraires) — frais de gestion
 *   Compte 635xxx (impôts taxes) — taxe foncière
 *   Compte 661xxx (charges financières) — intérêts emprunt
 *
 * Hors de ce plan (familles SANS ligne 2044 : dépôt de garantie, prêt, achat / vente, virement
 * interne, CCA, travaux d'agrandissement, Divers, frais bancaires, charges récupérables…) : aucun
 * compte n'est inventé. Ces mouvements ne sont PAS écrits, mais LISTÉS (`_listNonExportes`) — nombre,
 * totaux, ventilation par catégorie — avec la mention « non exportés : compte à définir avec
 * l'expert-comptable » : fichier `ecritures/mouvements-non-exportes.csv` du dossier ZIP, et message
 * à chaque téléchargement du FEC / journal / grand livre. Le FEC lui-même reste au format normé
 * (18 colonnes, aucune ligne libre). Rien ne disparaît en silence.
 *
 * Tests Vitest : __tests__/helpers/export-comptable.test.js
 */

/** Mapping STD_CATEGORIES → compte comptable + sens (D/C). */
const MAPPING_COMPTE = {
  '211': { compte: '706000', libelleCompte: 'Loyers', sens: 'C' },
  '213': { compte: '758000', libelleCompte: 'Produits divers de gestion', sens: 'C' },
  '221': { compte: '622000', libelleCompte: 'Honoraires de gestion', sens: 'D' },
  '223': { compte: '616000', libelleCompte: 'Primes d\'assurance', sens: 'D' },
  '224': { compte: '615200', libelleCompte: 'Entretien et réparations', sens: 'D' },
  '224bis': { compte: '615210', libelleCompte: 'Travaux rénovation énergétique', sens: 'D' },
  '225': { compte: '615280', libelleCompte: 'Charges récup non récupérées', sens: 'D' },
  '226': { compte: '658000', libelleCompte: 'Indemnités d\'éviction', sens: 'D' },
  '227': { compte: '635110', libelleCompte: 'Taxe foncière', sens: 'D' },
  '229': { compte: '615500', libelleCompte: 'Charges copropriété', sens: 'D' },
  '230': { compte: '615510', libelleCompte: 'Régul charges copro N-1', sens: 'D' },
  '250': { compte: '661100', libelleCompte: 'Intérêts d\'emprunt', sens: 'D' }
};

/**
 * Périmètre d'un export — PARTAGÉ par `_buildMvtRows` (ce qui est écrit) et `_listNonExportes` (ce qui
 * ne l'est pas) : même filtre période / entité, même résolution de catégorie. Les deux listes forment
 * donc, par construction, une partition des mouvements du périmètre.
 */
function _perimetre(stdCategories, opts) {
  const { from = '', to = '', entityNom = '', refs = [], catMere = null, dansPerimetre = null } = opts || {};
  const catByName = new Map();
  (stdCategories || []).forEach(c => catByName.set(c.nom, c));
  const inScope = m => {
    if (!m || m._deleted) return false;
    if ((from || to) && !m.date) return false;   // sans date : hors de toute période (Finances l'ignore aussi)
    if (from && m.date < from) return false;
    if (to && m.date > to) return false;
    // R-0 (audit lot 6 🔴1) : le périmètre de FINANCES, injecté par l'app (`_finScopeWeightCore` sur
    // `_finEntScope`) — mouvements du bailleur, de ses lots (refs tolérantes) ET de ses immeubles (qui vide
    // + imm). Le filtre historique ci-dessous (refs exactes) laissait disparaître ces derniers, ni écrits
    // ni listés. Il ne reste qu'en repli (appelants sans résolveur, tests historiques).
    if (dansPerimetre === false) return false;   // bailleur introuvable : rien, jamais le repli
    if (typeof dansPerimetre === 'function') return !!dansPerimetre(m);
    if (entityNom) {
      const isGlobal = m.qui === 'SCI:' + entityNom;
      const isInScope = refs && refs.includes(m.qui);
      if (!isGlobal && !isInScope) return false;
    }
    return true;
  };
  const stdDe = cat => catByName.get(cat) || (typeof catMere === 'function' ? catMere(cat) : null) || null;
  return { inScope, stdDe };
}
function _mappingDe(std) {
  return (std && std.ligne2044 && MAPPING_COMPTE[std.ligne2044]) || null;
}

/**
 * Vue « par mouvement » — SOURCE UNIQUE du filtre (période/entité) et de la
 * numérotation `num` séquentielle. `_buildEcritures` (écritures partie double) ET
 * le Dossier comptable (lien num ↔ facture) consomment cette même liste, ce qui
 * GARANTIT par construction l'alignement des `num` (même filtre, même ordre).
 *
 * `opts.catMere(nom)` (injecté par l'app : `_finCatMere`) rend la catégorie MÈRE du référentiel d'une
 * catégorie PERSO (alias M-1) — R-0 : sans lui, « Péage A35 » rangée en Divers ou « Loyer parking »
 * rangée en Recettes diverses étaient ABSENTES du FEC, du journal, du grand livre et du dossier ZIP,
 * alors que Finances et la 2044 les comptent. Sans `catMere`, seul le nom exact du référentiel compte.
 *
 * @returns {Array} - [{ num, mvt, std, mapping, montant, type, date, qui, lib, cat }]
 */
export function _buildMvtRows(mouvements, stdCategories, opts = {}) {
  const { inScope, stdDe } = _perimetre(stdCategories, opts);
  const rows = [];
  let num = 1;
  (mouvements || []).filter(inScope).forEach(m => {
    const std = stdDe(m.cat);
    const mapping = _mappingDe(std);
    if (!mapping) return; // non mappé ou type=special → listé par _listNonExportes
    // NET du mouvement dans le sens de sa catégorie (comme Finances : recette = cr − db, charge = db − cr).
    // Négatif = avoir / remboursement (assurance remboursée, loyer rendu) : écrit EN SENS INVERSE sur le
    // MÊME compte (`inverse`), jamais ignoré — sinon l'export dépasse Finances du montant de l'avoir.
    const net = (std.type === 'recette') ? (Number(m.cr) || 0) - (Number(m.db) || 0) : (Number(m.db) || 0) - (Number(m.cr) || 0);
    if (Math.abs(net) < 0.005) return;
    const montant = Math.round(Math.abs(net) * 100) / 100;
    rows.push({ num: num++, mvt: m, std, mapping, montant, inverse: net < 0, type: std.type, date: m.date, qui: m.qui || '', lib: m.lib || '', cat: m.cat || '' });
  });
  return rows;
}

export const NON_EXPORTES_MENTION = 'non exportés : compte à définir avec l\'expert-comptable';
const _r2 = n => Math.round(n * 100) / 100;

/**
 * Lot 6, A2 — les mouvements du périmètre que l'export N'ÉCRIT PAS (famille sans ligne 2044 ou sans
 * compte : dépôt de garantie, prêt, achat / vente, virement interne, CCA, Divers, frais bancaires,
 * charges récupérables, catégorie inconnue…). Aucun compte n'est inventé : ils sont listés, pour que
 * l'expert-comptable décide. Les mouvements sans montant (ni entrée ni sortie) ne sont pas listés.
 *
 * @returns {{ rows: Array<{date, qui, cat, famille, lib, entree, sortie}>, count, entrees, sorties,
 *             parCategorie: Array<{cat, famille, count, entrees, sorties}> }}  (montants arrondis au centime)
 */
export function _listNonExportes(mouvements, stdCategories, opts = {}) {
  const { inScope, stdDe } = _perimetre(stdCategories, opts);
  const rows = [];
  const parCat = new Map();
  (mouvements || []).filter(inScope).forEach(m => {
    const std = stdDe(m.cat);
    if (_mappingDe(std)) return;                             // écrit par l'export
    const entree = Number(m.cr) || 0, sortie = Number(m.db) || 0;
    if (!entree && !sortie) return;
    const cat = m.cat || '';
    const famille = !std ? 'sans famille' : (std.nom && std.nom !== cat ? std.nom : '');
    rows.push({ date: m.date || '', qui: m.qui || '', cat, famille, lib: m.lib || '', entree, sortie });
    let c = parCat.get(cat);
    if (!c) { c = { cat, famille, count: 0, entrees: 0, sorties: 0 }; parCat.set(cat, c); }
    c.count++; c.entrees += entree; c.sorties += sortie;
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const parCategorie = [...parCat.values()]
    .map(c => ({ ...c, entrees: _r2(c.entrees), sorties: _r2(c.sorties) }))
    .sort((a, b) => b.count - a.count || a.cat.localeCompare(b.cat, 'fr'));
  return {
    rows, count: rows.length,
    entrees: _r2(rows.reduce((s, r) => s + r.entree, 0)),
    sorties: _r2(rows.reduce((s, r) => s + r.sortie, 0)),
    parCategorie
  };
}

const _eur = n => (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';

/** Une phrase pour l'écran (toast, récapitulatif). '' s'il n'y a rien à signaler. */
export function _nonExportesResume(liste) {
  if (!liste || !liste.count) return '';
  return liste.count + ' mouvement' + (liste.count > 1 ? 's' : '') + ' (entrées ' + _eur(liste.entrees)
    + ', sorties ' + _eur(liste.sorties) + ') ' + NON_EXPORTES_MENTION;
}

/**
 * `ecritures/mouvements-non-exportes.csv` du dossier ZIP. En tête (lignes « # », comme index.csv) :
 * la mention, le périmètre, le nombre, les totaux et la ventilation par catégorie ; puis le détail.
 * Point décimal, comme les autres CSV du dossier.
 */
export function _nonExportesCsv(liste, meta = {}) {
  const l = liste || { rows: [], count: 0, entrees: 0, sorties: 0, parCategorie: [] };
  const L = _uneLigne;
  const head = [
    '# Mouvements ' + NON_EXPORTES_MENTION,
    '# date d\'extraction : ' + L(meta.extractionYmd) + ' · bailleur : ' + L(meta.entityNom || 'Tous') + ' · période : ' + L(meta.from) + ' → ' + L(meta.to),
    '# ' + l.count + ' mouvement(s) · entrées ' + l.entrees.toFixed(2) + ' · sorties ' + l.sorties.toFixed(2),
    ...(l.parCategorie || []).map(c => '# ' + L(c.cat) + (c.famille ? ' — famille : ' + L(c.famille) : '') + ' : ' + c.count + ' mouvement(s) · entrées ' + c.entrees.toFixed(2) + ' · sorties ' + c.sorties.toFixed(2))
  ];
  const cols = ['date', 'lot', 'categorie', 'famille', 'libelle', 'entree', 'sortie'];
  const lines = l.rows.map(r => [r.date, r.qui, r.cat, r.famille, r.lib, r.entree ? r.entree.toFixed(2) : '', r.sortie ? r.sortie.toFixed(2) : ''].map(_csvCell).join(','));
  return [...head, cols.join(','), ...lines].join('\n');
}

/**
 * Construit la liste des écritures (journal) pour une période + entité.
 *
 * @returns {Array} - [{ date, num, compte, libelleCompte, lib, qui, debit, credit, contrepartie }]
 */
export function _buildEcritures(mouvements, stdCategories, opts = {}) {
  const ecritures = [];
  _buildMvtRows(mouvements, stdCategories, opts).forEach(r => {
    const { num: numEcr, mapping, montant, std, mvt: m } = r;
    // 1 mouvement = 2 écritures (partie double : compte du tiers + compte de produit/charge)
    const tierCompte = std.type === 'recette' ? '411000' : '401000';
    const tierLib = std.type === 'recette' ? 'Client (locataire)' : 'Fournisseur';
    // Avoir / remboursement (`r.inverse`) : même comptes, sens inversé.
    if ((mapping.sens === 'C') !== !!r.inverse) {
      // Crédit du compte produit, débit du compte tiers
      ecritures.push({ date: m.date, num: numEcr, compte: tierCompte, libelleCompte: tierLib, lib: m.lib || '', qui: m.qui || '', debit: montant, credit: 0, contrepartie: mapping.compte });
      ecritures.push({ date: m.date, num: numEcr, compte: mapping.compte, libelleCompte: mapping.libelleCompte, lib: m.lib || '', qui: m.qui || '', debit: 0, credit: montant, contrepartie: tierCompte });
    } else {
      // Débit du compte charge, crédit du compte tiers
      ecritures.push({ date: m.date, num: numEcr, compte: mapping.compte, libelleCompte: mapping.libelleCompte, lib: m.lib || '', qui: m.qui || '', debit: montant, credit: 0, contrepartie: tierCompte });
      ecritures.push({ date: m.date, num: numEcr, compte: tierCompte, libelleCompte: tierLib, lib: m.lib || '', qui: m.qui || '', debit: 0, credit: montant, contrepartie: mapping.compte });
    }
  });
  return ecritures;
}

/**
 * Construit le grand livre (groupé par compte avec totaux).
 */
export function _buildGrandLivre(ecritures) {
  const byCompte = {};
  (ecritures || []).forEach(e => {
    if (!byCompte[e.compte]) {
      byCompte[e.compte] = { compte: e.compte, libelleCompte: e.libelleCompte, lignes: [], totalDebit: 0, totalCredit: 0 };
    }
    const lvr = byCompte[e.compte];
    lvr.lignes.push(e);
    lvr.totalDebit += e.debit;
    lvr.totalCredit += e.credit;
  });
  Object.values(byCompte).forEach(c => {
    c.solde = Math.round((c.totalDebit - c.totalCredit) * 100) / 100;
    c.totalDebit = Math.round(c.totalDebit * 100) / 100;
    c.totalCredit = Math.round(c.totalCredit * 100) / 100;
  });
  return Object.values(byCompte).sort((a, b) => a.compte.localeCompare(b.compte));
}

/**
 * Génère un FEC (Fichier Écritures Comptables) format DGFiP.
 *
 * Format texte avec tab `\t` séparateur, 18 colonnes :
 *   JournalCode | JournalLib | EcritureNum | EcritureDate | CompteNum | CompteLib |
 *   CompAuxNum | CompAuxLib | PieceRef | PieceDate | EcritureLib | Debit | Credit |
 *   EcritureLet | DateLet | ValidDate | Montantdevise | Idevise
 *
 * Référence : Arrêté du 29 juillet 2013, BOI-CF-IOR-60-40-20.
 *
 * `opts.pieceRefByNum` (optionnel) : map { num → nom de fichier facture } fournie
 * par le Dossier comptable pour relier chaque écriture à son justificatif dans le
 * .zip. Absent (export FEC autonome) → comportement historique `'M'+num`.
 */
export function _toFEC(ecritures, opts = {}) {
  const { entityNom = '', from = '', to = '', pieceRefByNum = null } = opts;
  const headers = [
    'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
    'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit',
    'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'
  ];
  const validDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rows = (ecritures || []).map(e => [
    'GEST',                                  // JournalCode (gestion locative)
    'Gestion locative',                       // JournalLib
    'GL' + String(e.num).padStart(6, '0'),    // EcritureNum
    e.date.replace(/-/g, ''),                  // EcritureDate (YYYYMMDD)
    e.compte,                                  // CompteNum
    (e.libelleCompte || '').slice(0, 50),     // CompteLib
    e.qui || '',                               // CompAuxNum (auxiliaire = ref locataire/fournisseur)
    (e.qui || '').slice(0, 50),                // CompAuxLib
    (pieceRefByNum && pieceRefByNum[e.num]) || ('M' + e.num), // PieceRef (nom fichier facture si Dossier comptable, sinon 'M'+num)
    e.date.replace(/-/g, ''),                  // PieceDate
    (e.lib || '').slice(0, 200).replace(/[\t\n\r]/g, ' '), // EcritureLib (anti-tab)
    e.debit ? e.debit.toFixed(2).replace('.', ',') : '0,00',
    e.credit ? e.credit.toFixed(2).replace('.', ',') : '0,00',
    '',                                        // EcritureLet (lettrage — vide V1)
    '',                                        // DateLet
    validDate,                                 // ValidDate
    '',                                        // Montantdevise (EUR uniquement)
    ''                                         // Idevise
  ]);
  return [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
}

/**
 * Échappement CSV + garde anti-injection de formule (Excel/Sheets exécutent une
 * cellule TEXTE commençant par = + @ ou tab/CR, ou par - non suivi d'un chiffre).
 * On préfixe une apostrophe pour neutraliser SANS toucher aux nombres négatifs
 * légitimes (soldes du grand livre). Puis quoting standard si , " ou saut de ligne.
 */
/** Texte d'une ligne de commentaire « # » d'un CSV : jamais de retour à la ligne (un nom de bailleur ou de
 *  catégorie qui en contiendrait ouvrirait une ligne de données — commençant par « = », une formule). */
export function _uneLigne(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
}

export function _csvCell(s) {
  let v = String(s == null ? '' : s);
  if (/^[=+@\t\r]/.test(v) || /^-(?![0-9])/.test(v)) v = "'" + v;
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

/** Génère un journal général en CSV (lisible humain + Excel). */
export function _journalToCsv(ecritures) {
  const headers = ['date', 'num', 'compte', 'libelle_compte', 'tier', 'libelle', 'debit', 'credit'];
  const rows = (ecritures || []).map(e => [
    e.date, e.num, e.compte, e.libelleCompte, e.qui || '', e.lib || '',
    e.debit ? e.debit.toFixed(2) : '', e.credit ? e.credit.toFixed(2) : ''
  ]);
  return [headers.join(','), ...rows.map(r => r.map(_csvCell).join(','))].join('\n');
}

/** Génère le grand livre en CSV. */
export function _grandLivreToCsv(grandLivre) {
  const headers = ['compte', 'libelle_compte', 'date', 'piece', 'libelle', 'debit', 'credit', 'solde_progression'];
  const rows = [];
  (grandLivre || []).forEach(lvr => {
    let solde = 0;
    lvr.lignes.forEach(l => {
      solde += (l.debit || 0) - (l.credit || 0);
      rows.push([lvr.compte, lvr.libelleCompte, l.date, 'M' + l.num, l.lib || '',
        l.debit ? l.debit.toFixed(2) : '', l.credit ? l.credit.toFixed(2) : '',
        solde.toFixed(2)]);
    });
    // Ligne totaux
    rows.push([lvr.compte, '== TOTAL ' + lvr.compte + ' ==', '', '', '',
      lvr.totalDebit.toFixed(2), lvr.totalCredit.toFixed(2), lvr.solde.toFixed(2)]);
  });
  return [headers.join(','), ...rows.map(r => r.map(_csvCell).join(','))].join('\n');
}
