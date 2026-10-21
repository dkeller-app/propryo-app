// js/core/bail-modifications.js — Modifications d'un bail SIGNÉ (hors avenant). Module PUR, testé.
//
// POURQUOI (incident 28/09, bail Ferrette 101) : la ligne du bail signé est verrouillée au cloud
// (store-sync.js : un bail `locked` n'est plus jamais poussé) → « Modifier le bail » perdait tout au
// rechargement. Décision Didier : ENREGISTRER les modifications À CÔTÉ du bail (journal
// `DB.baux_evenements`, table cloud `baux_evenements`, migration 0054), les RÉAPPLIQUER sur le bail
// au chargement, et les montrer dans la timeline. Le document SIGNÉ (signatures.bailSnapshot, PDF
// archivé) ne change jamais.
//
// Une entrée de journal :
//   { id, ref, bailDebut, signedAt, date (ISO), auteur, type:'modification',
//     changements: [{ champ:'locataires.0.tel', libelle:'Téléphone de M. HARNIST', avant, apres }],
//     _espaceId? (copié du bail : routage vers l'espace du propriétaire en partage SCI) }

/** Bail signé par TOUTES les parties (même règle que le scellement cloud `sealSignedBaux`). */
export function bailSigneComplet(bail) {
  const s = bail && bail.signatures;
  return !!(s && s.signedAt && s.mode !== 'bailleur-seul');
}

// Champs SUIVIS (liste fermée : un champ interne ou gelé n'entre jamais dans le journal).
// Libellés = ceux du formulaire « Modifier le bail ». `fin: true` = porté AUSSI par le barème daté
// (loyer / charges / dépôt) : réappliqué, mais pas affiché dans la carte (le barème a déjà la sienne).
export const CHAMPS_BAIL = {
  type: { l: 'Type de bail' },
  typeContrat: { l: 'Type de contrat' },
  modalitePaiement: { l: 'Modalité de paiement' },
  destinationLocaux: { l: 'Destination des locaux' },
  zoneTendue: { l: 'Zone tendue' },
  encadrementLoyers: { l: 'Encadrement des loyers' },
  premiereLoc: { l: 'Situation lors de cette mise en location' },
  dernierLoyerPrec: { l: 'Dernier loyer HC du précédent locataire' },
  loyerRefMajore: { l: 'Loyer de référence majoré' },
  loyerRef: { l: 'Loyer de référence' },   // CONTRAT-TYPE-2026-10
  complementLoyer: { l: 'Complément de loyer' },
  complementJustif: { l: 'Justification du complément de loyer' },
  // JAMAIS BLOQUER (retour Didier 28/09) : un changement de PARTIE (garant, bailleur, co-signataires,
  // locataires) est ENREGISTRÉ comme le reste — le bail signé ne change pas, l'app rappelle qu'un
  // avenant est juridiquement nécessaire, l'utilisateur décide.
  garant: { l: 'Garant' },
  garant2: { l: '2ᵉ garant' },
  entity: { l: 'Bailleur' },
  signataires: { l: 'Signataires du bailleur' },
  adrGarant: { l: 'Adresse du garant' },
  ddnGarant: { l: 'Date de naissance du garant' },
  lieuGarant: { l: 'Lieu de naissance du garant' },
  adrGarant2: { l: 'Adresse du 2ᵉ garant' },
  ddnGarant2: { l: 'Date de naissance du 2ᵉ garant' },
  lieuGarant2: { l: 'Lieu de naissance du 2ᵉ garant' },
  visale: { l: 'Garantie Visale (visa)' },
  withMandataire: { l: 'Mandataire' },
  plafondCaution: { l: 'Plafond de l\'engagement de caution' },
  hc: { l: 'Loyer HC', fin: true },
  ch: { l: 'Charges mensuelles', fin: true },
  dg: { l: 'Dépôt de garantie', fin: true },
  dgVerse: { l: 'Dépôt de garantie versé' },   // B4 (RETOURS-2026-10-05) : coche, sans mouvement bancaire
  debut: { l: 'Date de début du bail' },
  fin: { l: 'Date de fin du bail' },
  irl: { l: 'Trimestre IRL de référence' },
  jpay: { l: 'Jour de paiement' },
  adrBien: { l: 'Adresse du bien' },
  ftype: { l: 'Type de location' },
  etage: { l: 'Étage' },
  surf: { l: 'Surface' },
  villeSignature: { l: 'Ville de signature' },
  depensesEnergie: { l: 'Dépenses énergétiques estimées' },
  precedentLoc: { l: 'Précédent locataire parti depuis' },
  precedentLoyerDetail: { l: 'Dernier loyer du précédent locataire' },
  precedentLoyerDateVers: { l: 'Date de versement du dernier loyer du précédent locataire' },   // CONTRAT-TYPE-2026-10
  precedentLoyerDateRev: { l: 'Date de la dernière révision du loyer du précédent locataire' },
  travaux_inter_loc: { l: 'Travaux depuis le précédent locataire' },
  diag: { l: 'Date du diagnostic' },
  diagSoc: { l: 'Société de diagnostic' },
  notes: { l: 'Notes / conditions particulières' },
  quittanceDemandee: { l: 'Quittance demandée' },
  finEffective: { l: 'Date de fin effective' },
  finMotif: { l: 'Motif de fin' },
  locNouvelleAdr: { l: 'Nouvelle adresse du locataire' },
  dgRestitue: { l: 'Dépôt de garantie restitué' },
  dgRetenu: { l: 'Retenues sur le dépôt de garantie' },
  finNotes: { l: 'Notes de fin de bail' },
  natureEmplacement: { l: 'Nature de l\'emplacement' },
  locDomicile: { l: 'Adresse du locataire (domicile)' },
  emplNum: { l: 'N° d\'emplacement' },
  emplSurface: { l: 'Surface de l\'emplacement' },
  emplNiveau: { l: 'Niveau / localisation' },
  emplDesc: { l: 'Descriptif de l\'emplacement' },
  dureeGarageText: { l: 'Durée' },
  preavisGarage: { l: 'Préavis de résiliation' },
  garageIndexActive: { l: 'Indexation du loyer' },
  garageIndex: { l: 'Indice d\'indexation' },
  garageIndexBase: { l: 'Indice de base' },
  erpZoneRisque: { l: 'Zone à risque (ERP)' },
};
// Sous-champs d'un locataire suivis (le NOM compris : jamais bloqué, un avenant reste conseillé).
export const CHAMPS_LOCATAIRE = {
  nom: 'Nom', civilite: 'Civilité', ddn: 'Date de naissance', lieuNaiss: 'Lieu de naissance',
  tel: 'Téléphone', email: 'E-mail', adressePrecedente: 'Adresse précédente',
};

// VIE DU BAIL (chantier clôture/relocation, option B2 validée Didier 28/09) — champs écrits sur un bail
// signé PAR D'AUTRES ÉCRANS que « Modifier le bail » (assistant de départ, restitution du dépôt de
// garantie, régularisation, plan d'apurement, procédure, avenant, révision IRL, reprise). Ils ne sont
// PAS dans CHAMPS_BAIL à dessein : le formulaire ne les porte pas, et les y mettre ferait apparaître
// de faux écarts dans la confirmation de « Modifier le bail ». Ils sont journalisés AUTOMATIQUEMENT au
// point de synchro (store-sync.js) quand la ligne du bail est verrouillée au cloud, réappliqués au
// chargement comme les autres, et jamais affichés dans la carte « Modification » (chaque écran a déjà
// sa propre trace : barème, bailEvents, assistant de départ). Liste FERMÉE : un champ absent d'ici
// reste perdu au cloud sur un bail verrouillé — l'ajouter ici est le geste attendu.
export const CHAMPS_VIE = {
  depart: { l: 'Départ du locataire', t: 'objet' },
  dgRestitueAt: { l: 'Dépôt de garantie restitué le', t: 'texte' },
  dgRestitueMontant: { l: 'Montant du dépôt restitué', t: 'nombre' },
  dgDetailRetenues: { l: 'Détail des retenues sur le dépôt', t: 'texte' },
  dgAdresseNonCommuniquee: { l: 'Adresse de restitution non communiquée', t: 'booleen' },
  dgPenaliteArt22: { l: 'Pénalité de retard de restitution (art. 22)', t: 'nombre' },
  // DÉPÔT DÉTENU (17/10) : loyer dû réglé par le dépôt, décidé au solde de tout compte (lu par le moteur des loyers).
  dgRetenueLoyer: { l: 'Loyer retenu sur le dépôt de garantie', t: 'nombre' },
  // Audit avant bêta, lot D : retenue pour loyer décidée alors que les loyers dus étaient incalculables (à revérifier).
  dgRetenueLoyerAVerifier: { l: 'Retenue pour loyer à revérifier', t: 'booleen' },
  // `locNouvIban` (IBAN du locataire sortant) RETIRÉ (NORMALISATION-LOYERS, 01/10, RGPD) : l'IBAN n'est
  // plus demandé ni gardé. Hors liste, un ancien journal qui le porterait n'est plus réappliqué
  // (cheminAutorise le refuse) ; js/core/normalisation-loyers.js le purge des données.
  estimExclues: { l: 'Charges exclues de l\'estimation', t: 'liste' },
  planApurement: { l: 'Plan d\'apurement', t: 'objet' },
  procedure: { l: 'Procédure', t: 'objet' },
  avenants: { l: 'Avenants', t: 'liste' },
  chForfait: { l: 'Charges au forfait', t: 'booleen' },
  irlDerniereApplication: { l: 'Dernière révision IRL appliquée', t: 'texte' },
  reprisVerifie: { l: 'Bail repris vérifié', t: 'booleen' },
  // R0-C · Q1 révisé (05/10) : situation du locataire au début du suivi (solde d'ouverture). Un bail
  // signé et verrouillé au cloud doit pouvoir la recevoir : elle vit DANS le bail (aucune colonne).
  anteriorite: { l: 'Situation du locataire au début du suivi', t: 'objet' },
  quittAutoGen: { l: 'Quittances automatiques', t: 'booleen' },
};
// Pièces de la SIGNATURE posées APRÈS le scellement (archivage du PDF signé, certificat de preuve —
// `__immoArchiveBailPdf`). Seules ces sous-clés de `signatures` peuvent être journalisées : le reste
// (signedAt, bailSnapshot, mode, empreinte des termes, verrou) est le document signé, intouchable.
function _typeVieOk(t, v) {
  if (t === 'objet') return typeof v === 'object' && !Array.isArray(v);
  if (t === 'liste') return Array.isArray(v);
  if (t === 'texte') return typeof v === 'string';
  if (t === 'nombre') return (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d+(?:[.,]\d+)?$/.test(v.trim()));
  if (t === 'booleen') return typeof v === 'boolean';
  return false;
}
export const ARTEFACTS_SIGNATURE = ['cloudPdfKey', 'proof', 'contentHash', 'certRef', 'pdfNuKey'];   // pdfNuKey : PDF signé nu (SIG-3, lot B)

// Égalité « métier » : vide / null / absent sont identiques ; nombres comparés en nombre ;
// objets (visale) comparés par contenu. Évite les faux écarts (pf() rend 0 pour un champ vide…).
function _vide(v) { return v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => _vide(v[k]))); }
// Champs MONTANTS / NOMBRES : « 850 » et 850 identiques. Les autres restent du texte : un téléphone,
// un code postal ou un n° d'emplacement qui ne diffère que d'un zéro en tête EST une modification.
const CHAMPS_NUMERIQUES = new Set(['hc', 'ch', 'dg', 'dernierLoyerPrec', 'loyerRefMajore', 'loyerRef', 'complementLoyer', 'plafondCaution',
  'surf', 'depensesEnergie', 'dgRestitue', 'dgRetenu', 'jpay', 'emplSurface', 'dgRestitueMontant']);
function _norm(v, numerique) {
  if (_vide(v)) return '';
  if (typeof v === 'boolean') return v ? '1' : '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') { const t = v.trim(); return (numerique && /^-?\d+(?:[.,]\d+)?$/.test(t)) ? String(Number(t.replace(',', '.'))) : t; }
  return JSON.stringify(v);
}
// VISALE-GMBI : un visa se compare par ses champs RENSEIGNÉS — l'ancienne forme { visaId } et la forme
// complète { visaId, beneficiaires:'', loyerMax:null, validite:'', cautionValidee:false } sont le même visa.
function _visaleUtile(v) {
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const k of Object.keys(v).sort()) { const x = v[k]; if (x == null || x === '' || x === false) continue; o[k] = typeof x === 'string' ? x.trim() : x; }
  return Object.keys(o).length ? o : null;
}
export function memeValeur(a, b, champ) {
  if (champ != null && String(champ).split('.').pop() === 'visale') { a = _visaleUtile(a); b = _visaleUtile(b); }
  const numerique = champ == null || CHAMPS_NUMERIQUES.has(String(champ).split('.').pop());
  // false et vide : même chose (case décochée = rien de saisi)
  const na = a === false ? '' : _norm(a, numerique), nb = b === false ? '' : _norm(b, numerique);
  // 0 face à vide : pf('') rend 0 → pas une modification
  if (numerique && ((na === '0' && nb === '') || (na === '' && nb === '0'))) return true;
  return na === nb;
}

// Liste de locataires réduite aux sous-champs suivis (aucune clé inconnue, aucun prototype).
function _locsPropres(arr) {
  return (Array.isArray(arr) ? arr : []).filter(l => l && typeof l === 'object').slice(0, 20).map(l => {
    const o = {};
    for (const k of Object.keys(CHAMPS_LOCATAIRE)) if (l[k] != null) o[k] = typeof l[k] === 'object' ? '' : l[k];
    if (l.adressePrecedenteSameAsFirst != null) o.adressePrecedenteSameAsFirst = !!l.adressePrecedenteSameAsFirst;
    return o;
  });
}

function _designation(loc) {
  const civ = loc && (loc.civilite === 'M.' || loc.civilite === 'Mme') ? loc.civilite + ' ' : '';
  return civ + String((loc && loc.nom) || '').trim();
}

/**
 * Changements entre le bail en vigueur (`prev`) et le bail enregistré (`next`), champs suivis seulement.
 * Locataires comparés PAR POSITION ; ajout / retrait → la liste entière (champ 'locataires').
 * @returns {Array<{champ, libelle, avant, apres, fin?:true}>}
 */
export function diffModificationsBail(prev, next) {
  const p = prev || {}, n = next || {}, out = [];
  for (const [k, def] of Object.entries(CHAMPS_BAIL)) {
    if (!(k in n)) continue;   // champ absent du formulaire (ex. champs garage d'un bail d'habitation)
    if (memeValeur(p[k], n[k], k)) continue;
    const c = { champ: k, libelle: def.l, avant: p[k] === undefined ? null : p[k], apres: n[k] === undefined ? null : n[k] };
    if (def.fin) c.fin = true;
    out.push(c);
  }
  const lp = Array.isArray(p.locataires) ? p.locataires : [], ln = Array.isArray(n.locataires) ? n.locataires : [];
  // Ajout / retrait d'un locataire : la LISTE entière est enregistrée (nettoyée à la réapplication).
  if (lp.length !== ln.length) {
    out.push({ champ: 'locataires', libelle: 'Locataires', avant: _locsPropres(lp), apres: _locsPropres(ln) });
    return out;
  }
  for (let i = 0; i < Math.min(lp.length, ln.length); i++) {
    for (const [k, lib] of Object.entries(CHAMPS_LOCATAIRE)) {
      if (memeValeur(lp[i] && lp[i][k], ln[i] && ln[i][k], k)) continue;
      out.push({ champ: 'locataires.' + i + '.' + k, libelle: lib + ' de ' + _designation(ln[i]),
        avant: lp[i] && lp[i][k] !== undefined ? lp[i][k] : null, apres: ln[i] && ln[i][k] !== undefined ? ln[i][k] : null });
    }
  }
  return out;
}

/**
 * Écarts à JOURNALISER AUTOMATIQUEMENT entre l'état synchronisé d'un bail signé verrouillé
 * (`prev` = ligne cloud + journal déjà réappliqué) et son état vivant (`next`). Couvre les champs du
 * formulaire (CHAMPS_BAIL, y compris un champ RETIRÉ : écrit à null), les locataires, la vie du bail
 * (CHAMPS_VIE, marqués `vie`) et les pièces de signature posées après scellement (marquées `vie`).
 * @returns {Array<{champ, libelle, avant, apres, fin?:true, vie?:true}>}
 */
export function diffAutoBail(prev, next) {
  const p = prev || {}, n = next || {};
  // Un champ du formulaire présent avant et absent maintenant a été RETIRÉ : on le compare à null
  // (diffModificationsBail ignore les clés absentes de `next`, règle propre au formulaire).
  const nComplet = Object.assign({}, n);
  for (const k of Object.keys(CHAMPS_BAIL)) if (k in p && !(k in n)) nComplet[k] = null;
  const out = diffModificationsBail(p, nComplet);
  for (const [k, def] of Object.entries(CHAMPS_VIE)) {
    if (!(k in p) && !(k in n)) continue;
    if (memeValeur(p[k], n[k], k)) continue;
    out.push({ champ: k, libelle: def.l, avant: p[k] === undefined ? null : p[k], apres: n[k] === undefined ? null : n[k], vie: true });
  }
  const sp = (p.signatures && typeof p.signatures === 'object') ? p.signatures : {};
  const sn = (n.signatures && typeof n.signatures === 'object') ? n.signatures : {};
  for (const k of ARTEFACTS_SIGNATURE) {
    if (memeValeur(sp[k], sn[k], k)) continue;
    out.push({ champ: 'signatures.' + k, libelle: 'Pièce de signature (' + k + ')', avant: sp[k] === undefined ? null : sp[k], apres: sn[k] === undefined ? null : sn[k], vie: true });
  }
  return out;
}

/** Même signature (même `signedAt`, non vide) = même bail signé. Un autre `signedAt` = un autre bail. */
export function memeBailSigne(a, b) {
  const sa = a && a.signatures && a.signatures.signedAt, sb = b && b.signatures && b.signatures.signedAt;
  return !!(sa && sb && sa === sb);
}

/**
 * Entrée de journal AUTOMATIQUE pour un bail signé verrouillé, ou null si rien à journaliser.
 * `reference` = état synchronisé (copie profonde, JAMAIS l'objet vivant) ; le journal existant y est
 * réappliqué d'abord → une modification déjà journalisée (« Modifier le bail ») n'est jamais doublée.
 * PUR : ne modifie ni `bail`, ni `reference` reçue, ni `journal`.
 */
export function entreeJournalAuto(cle, bail, reference, journal, { date, id } = {}) {
  if (!bail || !reference || !memeBailSigne(reference, bail)) return null;
  const ref = JSON.parse(JSON.stringify(reference));
  reappliquerJournalBaux({ [cle]: ref }, journal);
  let changements = diffAutoBail(ref, bail);
  if (!changements.length) return null;
  const e = { id, ref: String(cle || '').split('@@')[0], bailDebut: bail.debut || '', signedAt: bail.signatures.signedAt,
    date, _modifiedAt: date, type: 'modification', source: 'auto', auteur: '', changements };
  if (bail._bailUid) e.bailUid = bail._bailUid;
  if (bail._espaceId != null) e._espaceId = bail._espaceId;   // routage vers l'espace du propriétaire (partage SCI)
  // CONVERGENCE (contre-audit v15.690, m-2) : l'entrée est rejouée sur la référence ; un changement que la
  // réapplication REFUSE (type inattendu, montant NaN…) ne convergerait jamais → il serait re-journalisé à
  // CHAQUE flush, sans fin. On ne garde que ce qui converge ; le reste est signalé, jamais bouclé.
  const essai = JSON.parse(JSON.stringify(ref));
  if (e._espaceId != null) essai._espaceId = e._espaceId; else delete essai._espaceId;   // même espace que l'entrée (appariement strict)
  reappliquerJournalBaux({ [cle]: essai }, [e]);
  const residu = new Set(diffAutoBail(essai, bail).map(c => c.champ));
  if (residu.size) {
    changements = changements.filter(c => !residu.has(c.champ));
    try { console.warn('[journal auto] bail ' + e.ref + ' : non journalisable (valeur refusée) → ' + [...residu].join(', ')); } catch (_e) { /* console absente */ }
  }
  if (!changements.length) return null;
  e.changements = changements;
  return e;
}

// Seuls les chemins SUIVIS sont réappliqués. Le journal vient de données partagées (cloud, SCI) :
// un chemin arbitraire pourrait réécrire le document signé (signatures.bailSnapshot…) ou polluer
// Object.prototype (__proto__). Liste fermée, vérifiée à la réapplication ; parties forcées en texte.
export function cheminAutorise(chemin) {
  const c = String(chemin || '');
  if (Object.prototype.hasOwnProperty.call(CHAMPS_BAIL, c)) return true;
  if (Object.prototype.hasOwnProperty.call(CHAMPS_VIE, c)) return true;
  // Pièces posées après scellement : 2 niveaux exactement, sous-clé de la liste fermée (jamais
  // signatures.signedAt / bailSnapshot / locked…).
  if (/^signatures\.[A-Za-z]+$/.test(c) && ARTEFACTS_SIGNATURE.includes(c.slice(11))) return true;
  if (c === 'locataires') return true;   // liste entière (ajout / retrait), nettoyée par _poser
  const m = c.match(/^locataires\.(\d{1,2})\.([A-Za-z]+)$/);
  return !!(m && Object.prototype.hasOwnProperty.call(CHAMPS_LOCATAIRE, m[2]));
}

function _poser(obj, chemin, valeur) {
  if (!cheminAutorise(chemin)) return false;
  if (chemin === 'locataires') { obj.locataires = _locsPropres(valeur); return true; }
  // Parties : toujours du TEXTE (jamais un objet injecté par le journal partagé).
  if (chemin === 'entity' || chemin === 'garant' || chemin === 'garant2' || /^locataires\.\d+\.nom$/.test(chemin)) valeur = typeof valeur === 'string' ? valeur : '';
  if (chemin === 'signataires') { obj.signataires = (Array.isArray(valeur) ? valeur : []).filter(x => typeof x === 'string').slice(0, 20); return true; }
  // Pièces de signature : types attendus seulement (clé de fichier / empreinte = texte ; preuve /
  // certificat = objet simple). Tout autre type est ignoré plutôt qu'injecté dans `signatures`.
  if (chemin === 'signatures.cloudPdfKey' || chemin === 'signatures.contentHash' || chemin === 'signatures.pdfNuKey') { if (valeur != null && typeof valeur !== 'string') return false; }
  // proof : la LISTE des signataires (_buildPresentielProof) ou un objet (audit v15.690, I1 : une liste était
  // rejetée → preuve jamais réappliquée, et une entrée de journal ajoutée à chaque flush) ; certRef : objet.
  if (chemin === 'signatures.proof') { if (valeur != null && typeof valeur !== 'object') return false; }
  if (chemin === 'signatures.certRef') { if (valeur != null && (typeof valeur !== 'object' || Array.isArray(valeur))) return false; }
  // Vie du bail : TYPE attendu seulement (audit v15.690, M4 : le journal est partagé — un type inattendu
  // casserait les écrans qui lisent ces champs). Refusé = ignoré, jamais injecté.
  if (Object.prototype.hasOwnProperty.call(CHAMPS_VIE, chemin) && valeur != null && !_typeVieOk(CHAMPS_VIE[chemin].t, valeur)) return false;
  // Valeur structurée (objet / liste) venue du journal PARTAGÉ : copie de données pures (aucun prototype,
  // aucune référence partagée entre le journal et le bail vivant).
  if (valeur != null && typeof valeur === 'object') { try { valeur = JSON.parse(JSON.stringify(valeur)); } catch (_e) { return false; } }
  const parts = String(chemin).split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (o[k] == null || typeof o[k] !== 'object') return false;   // locataire disparu : on n'invente rien
    o = o[k];
  }
  o[parts[parts.length - 1]] = valeur;
  return true;
}

/**
 * Entrées de journal qui concernent CE bail : même logement (clé nue), même signature (un bail
 * suivant sur le même logement a un autre `signedAt`), même espace. Triées par date croissante.
 */
export function journalDuBail(journal, cle, bail) {
  const ref = String(cle || '').split('@@')[0];
  const sAt = bail && bail.signatures && bail.signatures.signedAt;
  const esp = (bail && bail._espaceId) || null;
  return (Array.isArray(journal) ? journal : [])
    // Espace STRICT : l'entrée porte le tag de son bail (copié à la création, reposé à l'hydratation) ;
    // en mono-espace ni l'un ni l'autre n'est tagué. Jamais d'application croisée entre deux espaces.
    .filter(e => e && !e._deleted && e.type === 'modification' && e.ref === ref && sAt && e.signedAt === sAt
      && (e._espaceId || null) === esp)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * Entrées qui MODIFIENT LE CONTENU du bail depuis sa signature (au moins un changement hors « vie ») —
 * pour les écrans qui décident si le bail en vigueur diffère du document signé (signatures réinjectées,
 * « version signée d'origine », snapshot rétroactif). Le journal AUTOMATIQUE de la vie du bail (départ,
 * dépôt, pièces de signature… : changements `vie`) ne change pas les termes signés → il n'y compte pas (contre-audit
 * v15.690, I-2). La réapplication, elle, utilise TOUTES les entrées (journalDuBail).
 */
export function modificationsDuBail(journal, cle, bail) {
  return journalDuBail(journal, cle, bail).filter(e => (e.changements || []).some(c => c && !c.vie));
}

/**
 * Réapplique le journal sur les baux signés (au chargement). Idempotent : pose les valeurs `apres`
 * dans l'ordre des dates ; ne touche ni aux signatures ni au document signé.
 * @returns {number} nombre de baux modifiés
 */
export function reappliquerJournalBaux(baux, journal) {
  let n = 0;
  for (const [cle, bail] of Object.entries(baux || {})) {
    if (!bail || bail._deleted || !bailSigneComplet(bail)) continue;
    const entrees = journalDuBail(journal, cle, bail);
    if (!entrees.length) continue;
    for (const e of entrees) for (const c of (e.changements || [])) {
      if (!c || !c.champ || !_poser(bail, c.champ, c.apres)) continue;
      // Copies de premier niveau du 1ᵉʳ locataire tenues par saveBail (repli des lecteurs anciens).
      if (c.champ === 'locataires.0.ddn') bail.ddn = c.apres;
      if (c.champ === 'locataires.0.lieuNaiss') bail.lieuNaiss = c.apres;
      if (c.champ === 'locataires.0.nom') bail.nom = c.apres;
      if (c.champ === 'locataires') { const l0 = (bail.locataires || [])[0] || {}; bail.nom = l0.nom || ''; bail.ddn = l0.ddn || ''; bail.lieuNaiss = l0.lieuNaiss || ''; }
    }
    n++;
  }
  return n;
}

const _ENUMS = {
  type: { nu: 'Location vide', meuble: 'Meublé', etudiant: 'Étudiant', mobilite: 'Bail mobilité', garage: 'Garage / box / stockage', autre: 'Autre' },
  modalitePaiement: { echeoir: 'À échoir', echu: 'À terme échu' },
  typeContrat: { initial: 'Contrat initial' },
};
/** Valeur lisible pour la carte de la timeline (texte brut, à échapper par l'appelant). */
export function valeurLisible(champ, v) {
  // dgVerse : false (case décochée) et absent ont des sens OPPOSÉS (absent = présumé versé) → « Non », jamais « (vide »).
  if (v === false && String(champ).split('.').pop() === 'dgVerse') return 'Non';
  if (_vide(v) || v === false) return '(vide)';
  if (v === true) return 'Oui';
  const cle = String(champ).split('.').pop();
  if (_ENUMS[cle] && _ENUMS[cle][v]) return _ENUMS[cle][v];
  if (cle === 'visale' && typeof v === 'object') {
    if (!v.visaId) return '(vide)';
    const parts = ['n° ' + v.visaId];
    if (v.beneficiaires) parts.push(String(v.beneficiaires));
    if (Number(v.loyerMax) > 0) parts.push('loyer max ' + v.loyerMax + ' €');
    if (v.validite) parts.push('valable jusqu’au ' + valeurLisible('', v.validite));
    if (v.cautionValidee === true) parts.push('cautionnement validé');
    return parts.length === 1 ? String(v.visaId) : parts.join(' · ');   // n° seul : affichage historique inchangé
  }
  if (cle === 'locataires' && Array.isArray(v)) return v.map(l => _designation(l)).filter(Boolean).join(', ') || '(aucun)';
  if (Array.isArray(v)) return v.map(String).join(', ') || '(aucun)';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return d + '/' + m + '/' + y; }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
