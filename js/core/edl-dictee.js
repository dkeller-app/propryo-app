/**
 * js/core/edl-dictee.js — LOGIQUE PURE de la dictée d'EDL (chantier EDL-VOIX-IA, lots B1 à B3).
 *
 * Ce module décide QUOI envoyer à l'IA pour une pièce, et (lot B2) COMMENT une proposition acceptée
 * s'écrit dans les champs EXISTANTS de l'élément — sans jamais toucher un EDL signé, l'entrée signée
 * en mode sortie, ni l'état d'une ligne « note ». Aucune dépendance au DOM.
 */
import { estNote } from './edl-relecture.js';

export const MODES = Object.freeze({ ENTREE: 'entree', SORTIE: 'sortie' });
export const NOM_MAX = 120;   // = LIMITES.nomMax du relais (relay/src/ai/tasks/edl-piece.js)

/** Entrée de la tâche « edl-piece » pour la pièce `piece` ({ nom, elements:[{ nom }] }). */
export function entreePiece(piece, sortie) {
  const elements = [];
  ((piece && piece.elements) || []).forEach((x, i) => {
    const nom = String((x && x.nom) || '').replace(/\s+/g, ' ').trim();
    // Un nom de plus de 120 caractères ferait refuser toute la dictée par le relais : l'élément n'est
    // simplement pas proposé à l'IA (il reste saisissable à la main).
    if (nom && nom.length <= NOM_MAX) elements.push({ id: String(i), nom, note: estNote(nom) });
  });
  return { piece: String((piece && piece.nom) || 'Pièce').trim() || 'Pièce', mode: sortie ? MODES.SORTIE : MODES.ENTREE, elements };
}

/** Entrée pour la dictée des relevés (aucun élément : seuls les compteurs sont attendus). */
export function entreeCompteurs(sortie) {
  return { piece: 'Compteurs', mode: sortie ? MODES.SORTIE : MODES.ENTREE, elements: [] };
}

/** Noms affichés pendant l'enregistrement (aide-mémoire). */
export function nomsElements(piece) {
  return ((piece && piece.elements) || []).map((x) => String((x && x.nom) || '').trim()).filter(Boolean);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LOT B2 — inscrire une proposition acceptée dans les champs EXISTANTS de l'élément.
// Entrée : etatE / obsE (+ marque iaE). Sortie : etatS / obsS (+ marque iaS) — l'entrée signée n'est
// JAMAIS touchée en sortie. Une ligne « note » ne reçoit jamais d'état. Un EDL signé ne reçoit rien.
// Chaque inscription rend la valeur d'AVANT : « Annuler » la restitue (si personne n'y a touché depuis).
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const ETATS = Object.freeze(['Neuf', 'Bon état', "État d'usage", 'Mauvais état', 'Absent']);

export function champs(sortie) {
  return sortie ? { etat: 'etatS', obs: 'obsS', ia: 'iaS' } : { etat: 'etatE', obs: 'obsE', ia: 'iaE' };
}

/** Clé d'une décision : p:<elementId> (proposition), a:<rang> (élément à ajouter), c:<clé compteur>. */
export const cleProposition = (elementId) => `p:${elementId}`;
export const cleAjout = (rang) => `a:${rang}`;
export const cleCompteur = (cle) => `c:${cle}`;

/**
 * Retrouve l'élément visé dans la pièce ACTUELLE. L'id envoyé à l'IA est la position au moment de la
 * dictée ; si la pièce a bougé depuis (élément ajouté/supprimé), on retrouve l'élément par son nom.
 * -1 si introuvable (la proposition ne s'inscrit pas : jamais sur le mauvais élément).
 */
export function retrouverElement(piece, elementId, entree) {
  const els = (piece && piece.elements) || [];
  const snap = ((entree && entree.elements) || []).find((e) => e.id === String(elementId));
  if (!snap) return -1;
  const i = Number(elementId);
  const nom = (x) => String((x && x.nom) || '').replace(/\s+/g, ' ').trim();
  if (Number.isInteger(i) && els[i] && nom(els[i]) === snap.nom) return i;
  return els.findIndex((x) => nom(x) === snap.nom);
}

/** La proposition remplacerait-elle une saisie existante (différente) ? */
export function remplaceSaisie(element, prop, sortie) {
  const c = champs(sortie);
  const e = element || {};
  const etatDiff = !!(prop && prop.etat && e[c.etat] && e[c.etat] !== prop.etat);
  const obsDiff = !!(prop && prop.observation && e[c.obs] && String(e[c.obs]).trim() && String(e[c.obs]).trim() !== String(prop.observation).trim());
  return { etat: etatDiff ? e[c.etat] : null, obs: obsDiff ? e[c.obs] : null, oui: etatDiff || obsDiff };
}

/**
 * Calcule l'inscription. `choix` = ce que l'utilisateur a validé (accepté tel quel, ou modifié) :
 * { etat, observation } — undefined = garder la proposition ; null/'' = ne rien inscrire pour ce champ.
 * Rend { ok, raison?, patch, avant } ; `patch` ne contient que des champs de l'élément.
 */
export function calculerInscription(element, prop, { sortie = false, signe = false, modele = '', maintenant = new Date(), choix = {}, estNoteNom } = {}) {
  if (signe) return { ok: false, raison: 'signe' };
  if (!element) return { ok: false, raison: 'introuvable' };
  const c = champs(sortie);
  const note = typeof estNoteNom === 'function' ? estNoteNom(element.nom) : estNote(element.nom);
  let etat = choix.etat !== undefined ? choix.etat : (prop && prop.etat);
  let obs = choix.observation !== undefined ? choix.observation : (prop && prop.observation);
  if (note) etat = null;
  if (etat && !ETATS.includes(etat)) return { ok: false, raison: 'etat' };
  obs = obs == null ? '' : String(obs).trim();
  if (!etat && !obs) return { ok: false, raison: 'vide' };
  const patch = {};
  if (etat) patch[c.etat] = etat;
  if (obs) patch[c.obs] = obs;
  const modifie = choix.etat !== undefined || choix.observation !== undefined;
  // Marque lisible par machine : un champ non réécrit garde sa marque d'une dictée précédente.
  const prev = element[c.ia] || {};
  patch[c.ia] = { etat: !!etat || !!prev.etat, obs: !!obs || !!prev.obs, at: maintenant.toISOString(), modele: String(modele || ''), ...(modifie ? { modifie: true } : {}) };
  const avant = { [c.etat]: element[c.etat] || '', [c.obs]: element[c.obs] || '', [c.ia]: element[c.ia] ? { ...element[c.ia] } : null };
  return { ok: true, patch, avant };
}

/**
 * Annulation : restitue `avant` SEULEMENT si les champs portent encore exactement ce qui a été inscrit
 * (sinon quelqu'un a retouché depuis : on ne l'écrase pas). Rend { ok, patch } ou { ok:false, raison }.
 */
export function calculerAnnulation(element, inscrit, avant, { sortie = false, signe = false } = {}) {
  if (signe) return { ok: false, raison: 'signe' };
  if (!element || !inscrit || !avant) return { ok: false, raison: 'introuvable' };
  const c = champs(sortie);
  for (const k of [c.etat, c.obs]) {
    if (k in inscrit && String(element[k] || '') !== String(inscrit[k] || '')) return { ok: false, raison: 'modifie_depuis' };
  }
  // Seuls les champs ÉCRITS par l'inscription sont restitués (un champ non touché a pu être saisi depuis).
  const patch = { [c.ia]: avant[c.ia] || null };
  for (const k of [c.etat, c.obs]) if (k in inscrit) patch[k] = avant[k] || '';
  return { ok: true, patch };
}

/** Applique un patch sur l'élément (null = retire la clé). Mutation volontaire : _edlP est l'état vivant. */
export function appliquerPatch(element, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === undefined) delete element[k]; else element[k] = v;
  }
  return element;
}

/** Élément à ajouter (cité mais absent de la liste) → nouvel élément, mêmes champs qu'edlAddElem. */
export function nouvelElement(ajout, { sortie = false, modele = '', maintenant = new Date() } = {}) {
  const c = champs(sortie);
  const x = { nom: String(ajout.nom || '').trim(), etatE: '', obsE: '', photosE: [], etatS: '', obsS: '', photosS: [] };
  if (ajout.etat && ETATS.includes(ajout.etat)) x[c.etat] = ajout.etat;
  if (ajout.observation) x[c.obs] = String(ajout.observation).trim();
  x[c.ia] = { etat: !!x[c.etat], obs: !!x[c.obs], at: maintenant.toISOString(), modele: String(modele || '') };
  return x;
}

/** Bilan de relecture (pour les compteurs de l'écran et du bandeau). */
export function bilanDecisions(resultat, decisions = {}) {
  const r = resultat || {};
  const cles = [
    ...(r.propositions || []).map((p) => cleProposition(p.elementId)),
    ...(r.aAjouter || []).map((_, i) => cleAjout(i)),
    ...(r.compteurs || []).map((k) => cleCompteur(k.cle)),
  ];
  let inscrites = 0, ignorees = 0;
  for (const k of cles) {
    const d = decisions[k];
    if (d && d.statut === 'ok') inscrites++;
    else if (d && d.statut === 'ign') ignorees++;
  }
  return { total: cles.length, inscrites, ignorees, aValider: cles.length - inscrites - ignorees, propositions: (r.propositions || []).length };
}

/** Éléments de la pièce que la dictée ne cite pas (laissés intacts). */
export function nonCites(piece, resultat, entree) {
  const cites = new Set();
  for (const p of (resultat && resultat.propositions) || []) {
    const i = retrouverElement(piece, p.elementId, entree);
    if (i >= 0) cites.add(i);
  }
  return ((piece && piece.elements) || []).map((x, i) => ({ i, nom: String((x && x.nom) || '').trim() })).filter((x) => x.nom && !cites.has(x.i)).map((x) => x.nom);
}

// ── Relevés de compteurs (lot B3) ────────────────────────────────────────────────────────────────
export const COMPTEURS = Object.freeze({
  'elec-num': 'Électricité · N° de compteur', 'elec-hp': 'Électricité · index HP (kWh)', 'elec-hc': 'Électricité · index HC (kWh)',
  'gaz-num': 'Gaz · N° de compteur', 'gaz': 'Gaz · index (m³)',
  'eau-c-num': 'Eau chaude · N° de compteur', 'eau-c': 'Eau chaude · index (m³)',
  'eau-f-num': 'Eau froide · N° de compteur', 'eau-f': 'Eau froide · index (m³)',
});
export const estNumero = (cle) => /-num$/.test(cle);

/**
 * Champ EXISTANT qui reçoit le relevé : index → colonne d'entrée ou de sortie ; N° de compteur → le
 * champ unique (colonne d'entrée), jamais rempli depuis une dictée de sortie (peutInscrireCompteur).
 */
export function champCompteur(cle, sortie) {
  if (!COMPTEURS[cle]) return null;
  return 'edl-cpt-' + cle + (sortie && !estNumero(cle) ? '-s' : '');
}

/** Valeur affichée dans le champ (virgule décimale française). La valeur du relais est canonique (point). */
export function valeurCompteurAffichee(cle, valeur) {
  const v = String(valeur == null ? '' : valeur).trim();
  return estNumero(cle) ? v : v.replace('.', ',');
}

/** Un relevé dicté peut-il s'inscrire ? (EDL signé : non ; N° déjà noté en sortie : non, il ne change pas) */
export function peutInscrireCompteur(cle, { sortie = false, signe = false, valeurActuelle = '' } = {}) {
  if (signe) return { ok: false, raison: 'signe' };
  if (!COMPTEURS[cle]) return { ok: false, raison: 'cle' };
  // En sortie, le N° de compteur vit dans la colonne d'ENTRÉE : jamais écrit depuis une dictée de sortie.
  if (sortie && estNumero(cle)) return { ok: false, raison: String(valeurActuelle || '').trim() ? 'numero_deja_note' : 'numero_entree' };
  return { ok: true };
}

// ── Modèle de l'écran de relecture (lot B2) ──────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {object} o.item         dictée prête ({ resultat, decisions, entree, contexte })
 * @param {object|null} o.piece   pièce ACTUELLE (_edlP[pi]) ou null (dictée des relevés)
 * @param {boolean} o.sortie
 * @param {object} [o.compteursActuels]  { cle: valeur du champ }
 * @param {object} [o.compteursEntree]   { cle: relevé d'entrée } (sortie)
 */
export function modeleRelecture({ item, piece, sortie = false, compteursActuels = {}, compteursEntree = {} }) {
  const r = (item && item.resultat) || {};
  const dec = (item && item.decisions) || {};
  const c = champs(sortie);
  const corrections = r.corrections || [];
  const lignes = (r.propositions || []).map((p) => {
    const ei = piece ? retrouverElement(piece, p.elementId, item.entree) : -1;
    const el = ei >= 0 ? piece.elements[ei] : null;
    const cle = cleProposition(p.elementId);
    const d = dec[cle] || null;
    return {
      cle, prop: p, ei, introuvable: ei < 0,
      nom: el ? el.nom : (((item.entree && item.entree.elements) || []).find((e) => e.id === String(p.elementId)) || {}).nom || 'Élément',
      statut: d ? d.statut : '',
      remplace: el && !d ? remplaceSaisie(el, p, sortie) : { oui: false },
      entreeRef: sortie && el ? { etat: el.etatE || '', obs: el.obsE || '' } : null,
      actuel: el ? { etat: el[c.etat] || '', obs: el[c.obs] || '' } : null,
      corrections: corrections.filter((k) => String(p.source || '').toLowerCase().includes(String(k.entendu || '').toLowerCase())),
    };
  });
  const ajouts = (r.aAjouter || []).map((a, i) => ({ cle: cleAjout(i), a, statut: (dec[cleAjout(i)] || {}).statut || '' }));
  const compteurs = (r.compteurs || []).map((k) => {
    const cle = cleCompteur(k.cle);
    const actuel = String(compteursActuels[k.cle] || '');
    const peut = peutInscrireCompteur(k.cle, { sortie, valeurActuelle: actuel });
    return {
      cle, k, libelle: COMPTEURS[k.cle] || k.cle, valeur: valeurCompteurAffichee(k.cle, k.valeur),
      statut: (dec[cle] || {}).statut || '', actuel, bloque: peut.ok ? null : peut.raison,
      entree: sortie && !estNumero(k.cle) ? String(compteursEntree[k.cle] || '') : '',
      remplace: !!(actuel && actuel !== valeurCompteurAffichee(k.cle, k.valeur)),
    };
  });
  return {
    lignes, ajouts, compteurs, corrections,
    nonCites: piece ? nonCites(piece, r, item.entree) : [],
    bilan: bilanDecisions(r, dec),
    enAttente: lignes.filter((l) => !l.statut && !l.introuvable).length,
  };
}
