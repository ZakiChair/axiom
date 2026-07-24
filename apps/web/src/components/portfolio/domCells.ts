/**
 * Helpers DOM impératifs partagés par la fenêtre Portefeuille.
 *
 * Les PnL/expos LIVE sont écrits directement dans le DOM via des refs (AUCUN re-render
 * React sur tick, cf. BUILD-CONTRACT). Ces fonctions formatent une cellule sans passer
 * par le state React.
 */
import { formatUsd, formatPct } from "../../lib/format";

/** Cellules DOM d'une ligne, mises à jour impérativement (hors render-loop). */
export interface RowCells {
  prix: HTMLElement | null;
  pnl: HTMLElement | null;
  pct: HTMLElement | null;
}

/** Écrit un montant signé + coloré (tokens --up/--down) dans une cellule DOM. */
export function writeMoney(el: HTMLElement, n: number | undefined): void {
  if (n === undefined || !Number.isFinite(n)) {
    el.textContent = "—";
    el.style.color = "";
    return;
  }
  const plus = n > 0 ? "+" : ""; // le moins est déjà porté par formatUsd
  el.textContent = `${plus}${formatUsd(n)}`;
  el.style.color = n > 0 ? "var(--up)" : n < 0 ? "var(--down)" : "";
}

/** Écrit un pourcentage signé + coloré dans une cellule DOM. */
export function writePct(el: HTMLElement, pct: number | undefined): void {
  el.textContent = formatPct(pct);
  el.style.color =
    pct === undefined || !Number.isFinite(pct) ? "" : pct > 0 ? "var(--up)" : pct < 0 ? "var(--down)" : "";
}

/** Enregistre/retire une cellule DOM dans la map (callback de ref). */
export function registerCell(
  map: Map<string, RowCells>,
  id: string,
  field: keyof RowCells,
  el: HTMLElement | null,
): void {
  const cells = map.get(id) ?? { prix: null, pnl: null, pct: null };
  cells[field] = el;
  if (cells.prix === null && cells.pnl === null && cells.pct === null) map.delete(id);
  else map.set(id, cells);
}
