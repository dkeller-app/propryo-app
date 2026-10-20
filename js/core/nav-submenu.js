/**
 * core/nav-submenu.js — Modèle de rendu d'un sous-menu de sidebar (chantier NAV-SOUS-MENUS).
 *
 * Décide PUREMENT, pour un onglet de nav donné, s'il doit s'afficher comme un lien simple
 * ou comme un groupe dépliable avec ses sous-pages, à partir de :
 *   - le groupe (_NAV_GROUPS[x]) auquel l'onglet appartient (ou null s'il est autonome),
 *   - la page courante,
 *   - l'ensemble des pages visibles selon le menu perso (onSet),
 *   - l'ensemble des groupes actuellement dépliés (openSet, clés = 1re page-enfant du groupe).
 *
 * Règles :
 *   - onglet autonome (pas de groupe) → { kind:'link' } ;
 *   - un enfant masqué par le menu perso disparaît (sauf s'il EST la page courante) ;
 *   - si < 2 enfants restent visibles → { kind:'link' } (le parent redevient un lien simple,
 *     cohérent avec _navSubtabsHtml qui masque la barre à < 2 onglets) ;
 *   - sinon { kind:'group' } avec parentActive (page courante ∈ groupe), open (∈ openSet)
 *     et la liste des enfants { id, lb, active }.
 *
 * Sans DOM ni localStorage → testable (Vitest). Le shadow inline dans index.html est identique.
 */
export function navSubmenuModel(navId, group, page, onSet, openSet) {
  if (!group || !Array.isArray(group.tabs)) return { kind: 'link' };
  const groupKey = group.tabs[0][0];
  const children = group.tabs.filter(t => onSet.has(t[0]) || t[0] === page);
  if (children.length < 2) return { kind: 'link' };
  return {
    kind: 'group',
    groupKey,
    parentActive: group.tabs.some(t => t[0] === page),
    open: openSet.has(groupKey),
    children: children.map(t => ({ id: t[0], lb: t[1], active: t[0] === page }))
  };
}

/**
 * CDC-QUITTANCES-IRL étape 8 (D1/D2) — MIGRATION des préférences de menu.
 *
 * Le menu personnalisable est persisté PAR APPAREIL (localStorage), sous forme d'une liste
 * d'identifiants de page. L'étape 8 renomme ces identifiants pour qu'ils suivent enfin les
 * libellés, et en supprime un :
 *   `loyers`     (les mouvements)      → `mouvements`
 *   `quittances` (l'ancien onglet)     → `loyers`   (l'onglet « Loyers » l'absorbe)
 *   `irl`                              → retiré     (la table INSEE est un réglage)
 *
 * Sans cette migration, une préférence enregistrée avant la bascule ferait DISPARAÎTRE des
 * entrées du menu (les anciens identifiants ne sont plus dans `_MENU_ALL`, donc filtrés) —
 * l'utilisateur perdrait son menu sans comprendre pourquoi.
 *
 * PURE et IDEMPOTENTE : rejouée sur une liste déjà migrée, elle ne change rien.
 * L'ordre d'origine est conservé, les doublons créés par le renommage sont fusionnés.
 *
 * @param {Array<string>} ids liste enregistrée
 * @returns {Array<string>} liste migrée
 */
export function migrerIdsMenuLoyers(ids) {
  if (!Array.isArray(ids)) return [];
  const REN = { loyers: 'mouvements', quittances: 'loyers' };
  const RETIRES = new Set(['irl']);
  const dejaMigre = ids.includes('mouvements');
  const out = [];
  for (const raw of ids) {
    const id = String(raw == null ? '' : raw);
    if (!id || RETIRES.has(id)) continue;
    // `loyers` est ambigu : AVANT la bascule il désignait les mouvements, APRÈS l'onglet
    // Loyers. La présence de `mouvements` dans la liste prouve qu'elle est déjà migrée.
    const cible = (!dejaMigre && Object.prototype.hasOwnProperty.call(REN, id)) ? REN[id] : id;
    if (!out.includes(cible)) out.push(cible);
  }
  return out;
}
