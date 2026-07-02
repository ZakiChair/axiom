/**
 * Calcul PUR de l'ordre d'une liste de panes après un drag-and-drop (aucune
 * dépendance à KLineChart). Utilisé par `chart/paneHeaders.tsx`.
 */

/** Retourne le nouvel ordre de `paneIds` après avoir déplacé `draggedId` à
 * l'index `dropIndex` (calculé PARMI les éléments restants, une fois `draggedId`
 * retiré). `dropIndex` est borné à [0, longueur restante]. */
export function computeDropOrder(paneIds: string[], draggedId: string, dropIndex: number): string[] {
  if (!paneIds.includes(draggedId)) return paneIds;
  const withoutDragged = paneIds.filter((id) => id !== draggedId);
  const clampedIndex = Math.min(Math.max(dropIndex, 0), withoutDragged.length);
  return [...withoutDragged.slice(0, clampedIndex), draggedId, ...withoutDragged.slice(clampedIndex)];
}
