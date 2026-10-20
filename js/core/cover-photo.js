/**
 * core/cover-photo.js — quelle photo sert de vignette (chantier BIENS, P1-15).
 *
 * La donnée existait déjà (`photo.isCover` + bouton ⭐ dans la galerie) mais n'était lue nulle
 * part : la vignette du hero et celle des bulles affichaient une icône en dur.
 *
 * RÈGLE (mockup) : « la première photo sert de vignette — pour la changer, remonte-la en tête »,
 * la désignation explicite ⭐ gardant la priorité. « La première » = la première de la GALERIE,
 * qui trie du plus récent au plus ancien — c'est donc la plus récemment téléversée.
 *
 * Logique PURE, sortie du monolithe à la demande de l'audit : elle décide, elle n'affiche pas.
 */

/**
 * @param {Array} documents  DB.documents
 * @param {string} parentType 'logement' | 'immeuble' | 'entite'
 * @param {*} parentId
 * @returns {Object|null} la photo de couverture, ou null si le parent n'en a aucune
 */
export function choisirCouverture(documents, parentType, parentId) {
  if (!Array.isArray(documents) || !parentType || parentId == null) return null;
  const photos = documents.filter(d => d && !d._deleted
    && d.parentType === parentType && d.parentId === parentId && d.category === 'photos');
  if (!photos.length) return null;
  const explicite = photos.find(p => p.isCover);
  if (explicite) return explicite;
  // pas de ⭐ : la première de la galerie, qui va du plus récent au plus ancien
  return photos.slice().sort((a, b) =>
    String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))[0];
}
