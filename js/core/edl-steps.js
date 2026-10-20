/**
 * core/edl-steps.js — le PARCOURS DE L'EDL ENTIER (chantier EDL-TÉLÉPHONE, CDC §2.1/§2.2).
 *
 * La prod v15.545 n'a paginé QUE les pièces : les 8 sections administratives (6 884 px,
 * 63 % de la hauteur du téléphone) restaient empilées en permanence. Ce module fait de
 * CHAQUE section administrative une ÉTAPE au même titre qu'une pièce, dans l'ordre validé.
 *
 * Module PUR (ni DOM ni DB) : il répond à « quelles étapes, dans quel ordre, sous quel
 * libellé ? ». L'inline rend et masque ; ici on décide la LISTE. La navigation bornée
 * réutilise js/core/edl-parcours.js (indexClamp / suivante / …) — pas de doublon.
 *
 * Ordre validé (CDC §2.2) : Infos · Compteurs & équipements · Clés · Détecteur (DAAF) ·
 * [Mobilier — conditionnel, seulement si meublé, JAMAIS d'étape vide] · les 7 pièces ·
 * Observations + Signatures. Une seule étape à l'écran (invariant §2.10 nº2).
 */

/** Les étapes administratives fixes, dans l'ordre (hors pièces, hors fin, hors mobilier). */
export const ADMIN_HEAD = [
  { id: 'infos',     group: 'infos',     nom: 'Infos du logement' },
  { id: 'compteurs', group: 'compteurs', nom: 'Compteurs & équipements' },
  { id: 'cles',      group: 'cles',      nom: 'Clés remises' },
  { id: 'daaf',      group: 'daaf',      nom: 'Détecteur de fumée' },
];

/**
 * Construit la liste ordonnée des étapes de l'EDL.
 * @param {{mobilierEnabled?:boolean, pieceCount?:number, pieceNames?:string[]}} opts
 * @returns {Array<{id:string, group:string, kind:'admin'|'piece', nom:string, pieceIdx?:number}>}
 */
export function buildSteps(opts = {}) {
  // CHANTIER EDL-GARAGE — un EDL de garage (droit commun) n'a pas d'étapes logement :
  // pas de compteurs, pas de détecteur de fumée (DAAF), pas de mobilier. « Clés » devient
  // « Moyens d'accès » (clés / badge / bip). Les rubriques logement sont sans objet.
  const garage = !!opts.garage;
  const mobilierEnabled = !garage && !!opts.mobilierEnabled;
  const names = Array.isArray(opts.pieceNames) ? opts.pieceNames : [];
  const pieceCount = Number.isFinite(opts.pieceCount)
    ? Math.max(0, Math.trunc(opts.pieceCount))
    : names.length;

  let head = ADMIN_HEAD.map(s => ({ ...s, kind: 'admin' }));
  if (garage) {
    head = head
      .filter(s => s.id !== 'compteurs' && s.id !== 'daaf')
      .map(s => s.id === 'cles'  ? { ...s, nom: 'Moyens d\'accès (clés, badge, bip)' }
              : s.id === 'infos' ? { ...s, nom: 'Infos de l\'emplacement' }
              : s);
  }
  const steps = head;

  // Mobilier : étape à part ENTIÈRE, mais seulement pour un logement meublé (pas d'étape
  // vide pour un logement nu — CDC §2.2). Placée juste après le DAAF, avant les pièces :
  // l'inventaire d'objets se remplit d'un même geste que les pièces qui suivent.
  if (mobilierEnabled) {
    steps.push({ id: 'mobilier', group: 'mobilier', kind: 'admin', nom: 'Inventaire mobilier' });
  }

  for (let i = 0; i < pieceCount; i++) {
    steps.push({
      id: 'piece:' + i, group: 'pieces', kind: 'piece', pieceIdx: i,
      nom: (names[i] != null && String(names[i]).trim()) ? String(names[i]) : ('Pièce ' + (i + 1)),
    });
  }

  // Relecture avant signature (CDC §2.7, le « +1 ») : aperçu lecture seule de tout,
  // juste avant la signature. Écran MOBILE uniquement (masqué sur PC par _edlApplyStepVisibility).
  steps.push({ id: 'relecture', group: 'relecture', kind: 'admin', nom: 'Relecture avant signature' });
  steps.push({ id: 'fin', group: 'fin', kind: 'admin', nom: 'Observations + Signatures' });
  return steps;
}

/**
 * Décide si un nœud administratif de section doit être visible pour l'étape courante.
 * Cas particulier du MOBILIER (dual-home, invariant PC §2.9 : aucun déplacement du DOM) :
 *   - logement meublé  → la section mobilier n'est visible QUE sur l'étape « mobilier » ;
 *   - logement nu      → la section mobilier (réduite à son interrupteur « meublé ? ») est
 *     repliée dans l'étape « Infos » pour rester atteignable, sans créer d'étape vide.
 * @param {string} nodeGroup  le data-edl-step du nœud
 * @param {string} curGroup   le group de l'étape courante
 * @param {boolean} mobilierEnabled
 * @param {boolean} isMobilierSection  le nœud est-il #edl-mobilier-section ?
 */
export function sectionVisible(nodeGroup, curGroup, mobilierEnabled, isMobilierSection = false) {
  if (isMobilierSection) {
    return mobilierEnabled ? curGroup === 'mobilier' : curGroup === 'infos';
  }
  return nodeGroup === curGroup;
}

/** Libellé global du rail : « Étape 2 / 12 ». Borné, jamais de position hors plage.
 *  (Forme héritée idx/total — conservée : appelée avec un total déjà calculé.) */
export function stepGlobalLabel(idx, total) {
  const n = Number(idx), t = Number(total);
  if (!Number.isFinite(n) || !Number.isFinite(t) || t <= 0) return '';
  const pos = Math.min(Math.max(n + 1, 1), t);
  return 'Étape ' + pos + ' / ' + t;
}

/** Une étape est-elle NUMÉROTÉE dans le rail ? La relecture est le « +1 » NON numéroté
 *  (CDC §2.2/§2.7) : elle ne compte ni dans la position ni dans le dénominateur. Toutes
 *  les autres — les 4 admin de tête, le mobilier conditionnel, les pièces, la fin
 *  (Observations + Signatures) — sont numérotées. */
export function isNumbered(step) {
  return !!step && step.group !== 'relecture';
}

/** Nombre d'étapes numérotées = le DÉNOMINATEUR du rail (la relecture exclue).
 *  Logement nu 7 pièces → 12 ; meublé → 13 (CDC §2.2, « 12 étapes (+1 relecture) »). */
export function numberedTotal(steps) {
  return (steps || []).filter(isNumbered).length;
}

/** Libellé global du rail à partir de la LISTE des étapes : « Étape N / total », N et
 *  total EXCLUANT la relecture (§2.2). Sur l'étape de relecture elle-même le rail
 *  n'affiche pas ce libellé (il devient « Signer l'état des lieux ») : on rend malgré
 *  tout une position bornée cohérente (celle de la fin, immédiatement après). */
export function stepGlobalLabelFromSteps(steps, idx) {
  const arr = steps || [];
  const total = numberedTotal(arr);
  const n = Number(idx);
  if (!total || !Number.isFinite(n)) return '';
  let pos = 0;
  for (let i = 0; i < arr.length && i <= n; i++) if (isNumbered(arr[i])) pos++;
  pos = Math.min(Math.max(pos, 1), total);
  return 'Étape ' + pos + ' / ' + total;
}

/** Index de la première étape « pièce » (ou -1). Sert à démarrer un parcours sur les pièces si voulu. */
export function firstPieceStep(steps) {
  const arr = steps || [];
  for (let i = 0; i < arr.length; i++) if (arr[i] && arr[i].kind === 'piece') return i;
  return -1;
}
